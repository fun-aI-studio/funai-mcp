// Small HTTP helpers for the Streamable HTTP transport: header values, SSE parsing and the
// `x-mcp-header` tool annotations (MCP 2026-07-28).

// RFC 9110 token characters, the only ones allowed in a header name.
const TCHAR = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const PLAIN_VALUE = /^[\x20-\x7E\t]*$/;

/**
 * A header-safe form of `value`. Plain printable ASCII goes as is; anything else (non-ASCII,
 * control characters, leading or trailing whitespace, or text that looks like the sentinel)
 * is sent as `=?base64?<utf-8 base64>?=`.
 */
export function encodeHeaderValue(value) {
  const text = String(value);
  const plain =
    PLAIN_VALUE.test(text) && text === text.trim() && !(text.startsWith('=?base64?') && text.endsWith('?='));
  return plain ? text : `=?base64?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

/** The header text for a primitive argument, or undefined when it must be left out. */
export function headerValueFor(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return undefined;
}

const SKIP_KEYS = new Set(['const', 'default', 'enum', 'examples']);

function countAnnotations(node) {
  if (Array.isArray(node)) return node.reduce((n, item) => n + countAnnotations(item), 0);
  if (!node || typeof node !== 'object') return 0;
  let n = 0;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'x-mcp-header') n += 1;
    else if (SKIP_KEYS.has(key)) continue;
    else if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const sub of Object.values(value)) n += countAnnotations(sub);
    } else n += countAnnotations(value);
  }
  return n;
}

function primitiveType(type) {
  const allowed = ['string', 'integer', 'boolean'];
  if (typeof type === 'string') return allowed.includes(type);
  if (Array.isArray(type)) {
    const real = type.filter((t) => t !== 'null');
    return real.length === 1 && allowed.includes(real[0]);
  }
  return false;
}

/**
 * Header parameters a tool's inputSchema declares with `x-mcp-header`.
 * Returns { valid, reason, params: [{ path: [...keys], header }] }. A tool whose annotations
 * break the rules is invalid and must be left out of tools/list.
 */
export function collectHeaderParams(schema) {
  const params = [];
  const walk = (node, path) => {
    const props = node && typeof node === 'object' ? node.properties : undefined;
    if (!props || typeof props !== 'object' || Array.isArray(props)) return;
    for (const [name, sub] of Object.entries(props)) {
      if (!sub || typeof sub !== 'object') continue;
      const here = [...path, name];
      if (Object.prototype.hasOwnProperty.call(sub, 'x-mcp-header')) {
        params.push({ path: here, header: sub['x-mcp-header'], type: sub.type });
      }
      walk(sub, here);
    }
  };
  walk(schema, []);
  if (countAnnotations(schema) !== params.length) {
    return { valid: false, reason: 'x-mcp-header is only allowed on properties reachable through "properties"', params: [] };
  }
  const seen = new Set();
  for (const p of params) {
    if (typeof p.header !== 'string' || !TCHAR.test(p.header)) {
      return { valid: false, reason: `x-mcp-header on "${p.path.join('.')}" is not a valid header name`, params: [] };
    }
    if (!primitiveType(p.type)) {
      return { valid: false, reason: `x-mcp-header on "${p.path.join('.')}" needs a string, integer or boolean`, params: [] };
    }
    const lower = p.header.toLowerCase();
    if (seen.has(lower)) return { valid: false, reason: `x-mcp-header "${p.header}" is used twice`, params: [] };
    seen.add(lower);
  }
  return { valid: true, reason: null, params: params.map(({ path, header }) => ({ path, header })) };
}

export function valueAtPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Incremental text/event-stream parser (WHATWG rules: data lines join with \n). */
export class SseParser {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.buffer = '';
    this.data = [];
    this.event = '';
  }

  push(text) {
    this.buffer += text;
    for (;;) {
      const idx = this.buffer.search(/[\r\n]/);
      if (idx < 0) return;
      // A lone \r at the end may be the first half of \r\n: wait for the next chunk.
      if (this.buffer[idx] === '\r' && idx === this.buffer.length - 1) return;
      const width = this.buffer[idx] === '\r' && this.buffer[idx + 1] === '\n' ? 2 : 1;
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + width);
      this._line(line);
    }
  }

  end() {
    if (this.buffer) {
      const rest = this.buffer.replace(/\r$/, '');
      this.buffer = '';
      this._line(rest);
    }
    this._dispatch();
  }

  _line(line) {
    if (line === '') return this._dispatch();
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
    return undefined;
  }

  _dispatch() {
    if (this.data.length) this.onEvent({ event: this.event || 'message', data: this.data.join('\n') });
    this.data = [];
    this.event = '';
  }
}

/** Decoded text chunks of a fetch Response body. */
export async function* readText(body) {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

export async function discard(res) {
  try {
    await res.body?.cancel();
  } catch {
    // nothing to discard
  }
}

/** Parse a WWW-Authenticate header into { scheme, params }. */
export function parseWwwAuthenticate(header) {
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^\s*([A-Za-z0-9._~+/-]+)\s*(.*)$/s);
  if (!match) return null;
  const params = {};
  const re = /([A-Za-z0-9_.-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  let m;
  while ((m = re.exec(match[2])) !== null) {
    params[m[1].toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3];
  }
  return { scheme: match[1], params };
}
