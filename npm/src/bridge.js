// The stdio <-> Streamable HTTP relay. Every JSON-RPC message read from stdin becomes one POST
// to the remote server; every JSON-RPC message in the answer (plain JSON or an SSE stream) is
// written to stdout as one line.

import {
  SseParser,
  collectHeaderParams,
  discard,
  encodeHeaderValue,
  headerValueFor,
  parseWwwAuthenticate,
  readText,
  valueAtPath,
} from './http.js';

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const NAME_SOURCE = { 'tools/call': 'name', 'prompts/get': 'name', 'resources/read': 'uri' };

function isRequest(msg) {
  return typeof msg.method === 'string' && Object.prototype.hasOwnProperty.call(msg, 'id') && msg.id !== null;
}

function idKey(id) {
  return `${typeof id}:${String(id)}`;
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function isJsonRpc(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && value.jsonrpc === '2.0';
}

export class Bridge {
  constructor({ serverUrl, auth, fetchImpl = fetch, write, log = () => {}, userAgent = 'funai-mcp' }) {
    this.url = serverUrl;
    this.auth = auth;
    this.fetch = fetchImpl;
    this.write = write;
    this.log = log;
    this.userAgent = userAgent;
    this.sessionId = null;
    this.protocolVersion = null;
    this.initMessage = null;
    this.initDone = null;
    this.reinit = null;
    this.toolHeaders = new Map();
    this.inflight = new Map();
    this.pending = new Set();
    this.closed = false;
  }

  /** Handle one line of stdin. Returns a promise that settles when the message is done. */
  handleLine(line) {
    const text = line.trim();
    if (!text) return Promise.resolve();
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      this.write(rpcError(null, -32700, 'Parse error: each line must be one JSON-RPC message'));
      return Promise.resolve();
    }
    if (!isJsonRpc(msg)) {
      this.write(rpcError(null, -32600, 'Invalid Request: send one JSON-RPC 2.0 object per line (no batches)'));
      return Promise.resolve();
    }
    const task = this.handleMessage(msg).catch((err) => this._fail(msg, err));
    this.pending.add(task);
    task.finally(() => this.pending.delete(task));
    return task;
  }

  async handleMessage(msg) {
    if (this.closed) return;
    if (msg.method === 'notifications/cancelled') {
      const requestId = msg.params && msg.params.requestId;
      const ctl = requestId !== undefined ? this.inflight.get(idKey(requestId)) : undefined;
      // Older revisions take the notification over HTTP; 2026-07-28 cancels by closing the stream.
      if (this.sessionId) await this._send(msg);
      if (ctl) ctl.abort();
      return;
    }
    if (msg.method === 'initialize') {
      this.initMessage = msg;
      const sent = this._send(msg);
      this.initDone = sent.catch(() => {});
      return sent;
    }
    if (this.initDone) await this.initDone;
    return this._send(msg);
  }

  /** Wait up to `graceMs` for requests in flight, then stop them and end the session. */
  async close(graceMs = 0) {
    if (this.closed) return;
    if (graceMs > 0 && this.pending.size) {
      let timer;
      await Promise.race([
        Promise.allSettled([...this.pending]),
        new Promise((resolve) => {
          timer = setTimeout(resolve, graceMs);
        }),
      ]);
      clearTimeout(timer);
    }
    this.closed = true;
    for (const ctl of this.inflight.values()) ctl.abort();
    if (this.sessionId) {
      const headers = { 'Mcp-Session-Id': this.sessionId, 'User-Agent': this.userAgent };
      if (this.protocolVersion) headers['MCP-Protocol-Version'] = this.protocolVersion;
      try {
        const authorization = await this.auth.authorization();
        if (authorization) headers.Authorization = authorization;
        const res = await this.fetch(this.url, { method: 'DELETE', headers, signal: AbortSignal.timeout(5_000) });
        await discard(res);
      } catch {
        // The server expires idle sessions on its own.
      }
      this.sessionId = null;
    }
  }

  _headers(msg, authorization) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': this.userAgent,
    };
    if (authorization) headers.Authorization = authorization;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    const metaVersion = msg.params && msg.params._meta && msg.params._meta[META_VERSION];
    const version =
      typeof metaVersion === 'string' ? metaVersion : msg.method === 'initialize' ? null : this.protocolVersion;
    if (version) headers['MCP-Protocol-Version'] = version;
    if (typeof msg.method === 'string') {
      headers['Mcp-Method'] = encodeHeaderValue(msg.method);
      const field = NAME_SOURCE[msg.method];
      const name = field && msg.params ? msg.params[field] : undefined;
      if (typeof name === 'string') headers['Mcp-Name'] = encodeHeaderValue(name);
      if (msg.method === 'tools/call' && msg.params) {
        for (const { path, header } of this.toolHeaders.get(msg.params.name) || []) {
          const value = headerValueFor(valueAtPath(msg.params.arguments, path));
          if (value !== undefined) headers[`Mcp-Param-${header}`] = encodeHeaderValue(value);
        }
      }
    }
    return headers;
  }

  async _send(msg, { sink = this.write, ctl = null, attempt = {}, internal = false } = {}) {
    const request = isRequest(msg);
    const controller = ctl || new AbortController();
    if (request && !ctl) this.inflight.set(idKey(msg.id), controller);
    try {
      const authorization = await this.auth.authorization();
      // While a new session is starting, wait for it rather than going out with none.
      if (this.reinit && !internal) await this.reinit.catch(() => {});
      const usedSession = this.sessionId;
      let res;
      try {
        res = await this.fetch(this.url, {
          method: 'POST',
          headers: this._headers(msg, authorization),
          body: JSON.stringify(msg),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        const cause = err && err.cause && (err.cause.code || err.cause.message);
        throw new Error(`Could not reach FunAI at ${this.url}${cause ? ` (${cause})` : ''}`);
      }

      if (res.status === 401 && !attempt.auth) {
        await discard(res);
        await this.auth.onUnauthorized(res.headers.get('www-authenticate'), authorization);
        return this._send(msg, { sink, ctl: controller, attempt: { ...attempt, auth: true }, internal });
      }
      if (res.status === 403 && !attempt.scope) {
        const challenge = parseWwwAuthenticate(res.headers.get('www-authenticate'));
        if (challenge && challenge.params.error === 'insufficient_scope' && !this.auth.apiKey) {
          await discard(res);
          await this.auth.onInsufficientScope(challenge.params.scope);
          return this._send(msg, { sink, ctl: controller, attempt: { ...attempt, scope: true }, internal });
        }
      }
      if (res.status === 404 && usedSession && this.initMessage && msg.method !== 'initialize' && !attempt.session) {
        await discard(res);
        // Only the first request to find the session gone starts a new one; the others
        // retry on whichever session is current by then.
        if (usedSession === this.sessionId) await this._reinitialize();
        return this._send(msg, { sink, ctl: controller, attempt: { ...attempt, session: true } });
      }
      await this._deliver(msg, res, sink);
    } catch (err) {
      if (controller.signal.aborted) return;
      throw err;
    } finally {
      if (request && !ctl && this.inflight.get(idKey(msg.id)) === controller) this.inflight.delete(idKey(msg.id));
    }
  }

  /** A legacy session expired: start a new one with the client's own initialize request. */
  async _reinitialize() {
    if (!this.reinit) {
      this.reinit = (async () => {
        this.log('The FunAI session expired; starting a new one.');
        this.sessionId = null;
        const replay = { ...this.initMessage, id: `funai-mcp-reinit-${Date.now()}` };
        let ok = false;
        await this._send(replay, {
          sink: (m) => {
            if (m.id === replay.id && m.result) ok = true;
          },
          internal: true,
        });
        if (!ok) throw new Error('FunAI refused to start a new session');
        await this._send(
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { sink: () => {}, internal: true, attempt: { session: true } },
        );
      })();
      this.reinit.finally(() => {
        this.reinit = null;
      }).catch(() => {});
    }
    return this.reinit;
  }

  async _deliver(msg, res, sink) {
    const request = isRequest(msg);
    if (msg.method === 'initialize') {
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
    }
    const emit = (m) => sink(request && m && !('method' in m) && m.id === msg.id ? this._onResponse(msg, m) : m);

    if (res.status === 202 || res.status === 204) {
      await discard(res);
      if (request) sink(rpcError(msg.id, -32603, 'FunAI accepted the request but sent no answer'));
      return;
    }

    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (res.ok && type.startsWith('text/event-stream')) {
      let answered = false;
      const parser = new SseParser((event) => {
        if (event.event !== 'message' || !event.data) return;
        let m;
        try {
          m = JSON.parse(event.data);
        } catch {
          this.log('Ignored an event that was not JSON.');
          return;
        }
        if (!isJsonRpc(m)) {
          this.log('Ignored an event that was not one JSON-RPC message.');
          return;
        }
        const answers = request && !('method' in m) && m.id === msg.id;
        try {
          emit(m);
        } catch (err) {
          this.log(`Could not pass on a message from FunAI: ${err && err.message}`);
          return;
        }
        if (answers) answered = true;
      });
      for await (const chunk of readText(res.body)) parser.push(chunk);
      parser.end();
      if (request && !answered) {
        sink(
          rpcError(
            msg.id,
            -32603,
            'FunAI closed the stream before answering. If this was a paid call, check list_generations before trying again.',
          ),
        );
      }
      return;
    }

    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const messages = Array.isArray(body) ? body.filter(isJsonRpc) : isJsonRpc(body) ? [body] : [];
    if (messages.length) {
      let answered = false;
      for (const m of messages) {
        // Transport-level errors often carry id null; give them back to the request they answer.
        const fixed = request && m.error && (m.id === null || m.id === undefined) && !answered ? { ...m, id: msg.id } : m;
        if (request && !('method' in fixed) && fixed.id === msg.id) answered = true;
        emit(fixed);
      }
      if (request && !answered) sink(rpcError(msg.id, -32603, `FunAI answered HTTP ${res.status} without a result`));
      return;
    }
    if (!res.ok) {
      if (request) sink(rpcError(msg.id, -32603, this._httpMessage(res)));
      else this.log(`FunAI answered HTTP ${res.status} to ${msg.method || 'a response'}.`);
      return;
    }
    if (request) sink(rpcError(msg.id, -32603, 'FunAI sent an empty or unreadable answer'));
  }

  _httpMessage(res) {
    if (res.status === 429) {
      const wait = res.headers.get('retry-after');
      return `FunAI rate limit reached${wait ? `; retry after ${wait}s` : ''}`;
    }
    if (res.status === 404 || res.status === 405) return `FunAI does not serve MCP at ${this.url} (HTTP ${res.status})`;
    return `FunAI answered HTTP ${res.status}`;
  }

  _onResponse(request, response) {
    if (request.method === 'initialize' && response.result && typeof response.result.protocolVersion === 'string') {
      this.protocolVersion = response.result.protocolVersion;
    }
    if (request.method === 'tools/list' && response.result && Array.isArray(response.result.tools)) {
      const tools = [];
      for (const tool of response.result.tools) {
        const found = collectHeaderParams(tool && tool.inputSchema);
        if (!found.valid) {
          this.log(`Left out tool "${tool && tool.name}": ${found.reason}.`);
          continue;
        }
        if (found.params.length) this.toolHeaders.set(tool.name, found.params);
        else this.toolHeaders.delete(tool.name);
        tools.push(tool);
      }
      return { ...response, result: { ...response.result, tools } };
    }
    return response;
  }

  _fail(msg, err) {
    const message = err && err.message ? err.message : 'funai-mcp failed';
    if (isRequest(msg)) this.write(rpcError(msg.id, -32603, message));
    else this.log(message);
  }
}
