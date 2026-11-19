// Mock servers for the tests: a remote MCP server (Streamable HTTP) and an OAuth
// authorization server. Both listen on 127.0.0.1 with random ports.

import crypto from 'node:crypto';
import http from 'node:http';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

export const TOOLS = [
  {
    name: 'echo',
    description: 'Echo the arguments.',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', 'x-mcp-header': 'Region' },
        count: { type: 'integer', 'x-mcp-header': 'Count' },
        note: { type: 'string' },
      },
    },
  },
  {
    name: 'broken',
    description: 'Annotates a number, which the spec forbids.',
    inputSchema: { type: 'object', properties: { size: { type: 'number', 'x-mcp-header': 'Size' } } },
  },
  { name: 'slow', description: 'Never answers on its own.', inputSchema: { type: 'object', properties: {} } },
];

/**
 * A remote MCP server. `tokens` holds the Authorization values it accepts. Legacy requests
 * need the session from initialize; requests that carry a 2026-07-28 `_meta` protocol
 * version are stateless.
 */
export async function startMcpServer({ tokens = ['Bearer test-key'], issuer = null } = {}) {
  const requests = [];
  const state = { tokens: new Set(tokens), sessions: new Set(), issuer, open: new Set(), protectedResource: null };
  let base = '';
  let sessionCount = 0;

  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });

    if (req.url.startsWith('/.well-known/oauth-protected-resource')) {
      send(res, 200, state.protectedResource || {
        resource: base,
        authorization_servers: [state.issuer],
        scopes_supported: ['read', 'generate'],
      });
      return;
    }
    if (!state.tokens.has(req.headers.authorization)) {
      send(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Authentication required' } }, {
        'WWW-Authenticate': `Bearer realm="mock", resource_metadata="${base}/.well-known/oauth-protected-resource", scope="read generate"`,
      });
      return;
    }
    if (req.method === 'DELETE') {
      state.sessions.delete(req.headers['mcp-session-id']);
      res.writeHead(204);
      res.end();
      return;
    }
    const msg = body;
    if (msg.method === 'initialize') {
      sessionCount += 1;
      const sid = `session-${sessionCount}`;
      state.sessions.add(sid);
      send(
        res,
        200,
        { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1.0.0' } } },
        { 'Mcp-Session-Id': sid },
      );
      return;
    }
    const stateless = msg.params && msg.params._meta && msg.params._meta['io.modelcontextprotocol/protocolVersion'];
    if (!stateless && !req.headers['mcp-session-id']) {
      // As FunAI does: a legacy request without a session is a client error, not an expiry.
      send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Missing Mcp-Session-Id. Call initialize first.' } });
      return;
    }
    if (!stateless && !state.sessions.has(req.headers['mcp-session-id'])) {
      send(res, 404, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session not found' } });
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(msg, 'id')) {
      res.writeHead(202);
      res.end();
      return;
    }
    if (msg.method === 'tools/list') {
      send(res, 200, { jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
      return;
    }
    if (msg.method === 'boom') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('internal error');
      return;
    }
    if (msg.method === 'tools/call' && msg.params && msg.params.name === 'slow') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': waiting\n\n');
      state.open.add(res);
      req.on('close', () => state.open.delete(res));
      return;
    }
    if (msg.method === 'tools/call' && String(req.headers.accept || '').includes('text/event-stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const progress = { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 1, progress: 50 } };
      const result = { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(msg.params.arguments || {}) }] } };
      // Split across writes, including a \r\n pair broken between chunks.
      const text = `: keep-alive\r\n\r\nevent: message\r\ndata: ${JSON.stringify(progress)}\r\n\r\ndata: ${JSON.stringify(result)}\r`;
      res.write(text.slice(0, 17));
      res.write(text.slice(17));
      res.end('\n\r\n');
      return;
    }
    send(res, 200, { jsonrpc: '2.0', id: msg.id, result: {} });
  });
  base = await listen(server);
  return {
    url: base,
    requests,
    state,
    posts: () => requests.filter((r) => r.method === 'POST'),
    close: () =>
      new Promise((resolve) => {
        for (const res of state.open) res.destroy();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * An OAuth authorization server with issuer `<base>/auth` (path-inserted RFC 8414 metadata),
 * DCR, PKCE S256 and refresh-token rotation. `onIssue(token)` is called for every access token.
 * Like auth-service, replaying a rotated refresh token revokes the whole grant (its family).
 * `opts.refreshStatus` makes refreshes answer that HTTP status as an outage would.
 */
export async function startAuthServer({ onIssue = () => {}, onRevokeAccess = () => {} } = {}) {
  const seen = { registrations: [], authorizations: [], tokens: [], revocations: [], reuse: [] };
  const opts = { iss: undefined, failRefresh: false, refreshStatus: 0, metadata: {} };
  const revokedFamilies = new Set();
  const clients = new Map();
  const codes = new Map();
  const refresh = new Map();
  let n = 0;
  let base = '';
  const issuer = () => `${base}/auth`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const raw = await readBody(req);
    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server/auth') {
      send(res, 200, {
        issuer: issuer(),
        authorization_endpoint: `${base}/auth/authorize`,
        token_endpoint: `${base}/auth/token`,
        registration_endpoint: `${base}/auth/register`,
        revocation_endpoint: `${base}/auth/revoke`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
        ...opts.metadata,
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/auth/register') {
      const body = JSON.parse(raw);
      seen.registrations.push(body);
      n += 1;
      const client = { client_id: `client-${n}`, ...body };
      clients.set(client.client_id, client);
      send(res, 201, client);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/auth/authorize') {
      const q = Object.fromEntries(url.searchParams);
      seen.authorizations.push(q);
      const client = clients.get(q.client_id);
      if (!client || !client.redirect_uris.includes(q.redirect_uri) || q.code_challenge_method !== 'S256') {
        send(res, 400, { error: 'invalid_request' });
        return;
      }
      n += 1;
      const code = `code-${n}`;
      codes.set(code, { ...q });
      const to = new URL(q.redirect_uri);
      to.searchParams.set('code', code);
      to.searchParams.set('state', q.state);
      if (opts.iss !== null) to.searchParams.set('iss', opts.iss === undefined ? issuer() : opts.iss);
      res.writeHead(302, { Location: to.href });
      res.end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/auth/token') {
      const form = Object.fromEntries(new URLSearchParams(raw));
      seen.tokens.push(form);
      const issue = (clientId, resource, scope, family) => {
        n += 1;
        const access = `access-${n}-${crypto.randomBytes(4).toString('hex')}`;
        const rt = `refresh-${n}-${crypto.randomBytes(4).toString('hex')}`;
        refresh.set(rt, { clientId, resource, scope, access, used: false, family: family || rt });
        onIssue(access);
        send(res, 200, { access_token: access, token_type: 'Bearer', expires_in: 900, refresh_token: rt, scope });
      };
      if (form.grant_type === 'authorization_code') {
        const grant = codes.get(form.code);
        codes.delete(form.code);
        const challenge = form.code_verifier ? b64url(crypto.createHash('sha256').update(form.code_verifier).digest()) : null;
        if (
          !grant ||
          grant.client_id !== form.client_id ||
          grant.redirect_uri !== form.redirect_uri ||
          grant.code_challenge !== challenge ||
          grant.resource !== form.resource
        ) {
          send(res, 400, { error: 'invalid_grant' });
          return;
        }
        issue(form.client_id, form.resource, grant.scope);
        return;
      }
      if (form.grant_type === 'refresh_token') {
        if (opts.refreshStatus) {
          send(res, opts.refreshStatus, { error: 'temporarily_unavailable' });
          return;
        }
        const entry = refresh.get(form.refresh_token);
        if (entry && entry.used && !revokedFamilies.has(entry.family)) {
          seen.reuse.push(form.refresh_token);
          revokedFamilies.add(entry.family);
          for (const e of refresh.values()) if (e.family === entry.family) onRevokeAccess(e.access);
        }
        if (
          opts.failRefresh ||
          !entry ||
          entry.used ||
          revokedFamilies.has(entry.family) ||
          entry.clientId !== form.client_id ||
          entry.resource !== form.resource
        ) {
          send(res, 400, { error: 'invalid_grant' });
          return;
        }
        entry.used = true;
        onRevokeAccess(entry.access);
        issue(entry.clientId, entry.resource, entry.scope, entry.family);
        return;
      }
      send(res, 400, { error: 'unsupported_grant_type' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/auth/revoke') {
      const form = Object.fromEntries(new URLSearchParams(raw));
      seen.revocations.push(form);
      const entry = refresh.get(form.token);
      if (entry) {
        revokedFamilies.add(entry.family);
        for (const e of refresh.values()) if (e.family === entry.family) onRevokeAccess(e.access);
      }
      res.writeHead(200);
      res.end();
      return;
    }
    send(res, 404, { error: 'not_found' });
  });
  base = await listen(server);
  return {
    url: base,
    issuer: issuer(),
    seen,
    opts,
    refresh,
    revokedFamilies,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** Plays the browser: follow the authorization redirect to the loopback callback. */
export function fakeBrowser() {
  const opened = [];
  const open = async (url) => {
    opened.push(url);
    const res = await fetch(url, { redirect: 'manual' });
    const location = res.headers.get('location');
    await res.text();
    if (location) {
      const back = await fetch(location);
      await back.text();
    }
    return true;
  };
  return { open, opened };
}

export function collector() {
  const lines = [];
  return { lines, write: (m) => lines.push(m) };
}
