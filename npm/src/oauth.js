// OAuth 2.1 for a native MCP client: protected-resource metadata (RFC 9728), authorization
// server metadata (RFC 8414), Dynamic Client Registration (RFC 7591), authorization code with
// PKCE S256, the resource parameter (RFC 8707), the iss check (RFC 9207) and a loopback
// redirect (RFC 8252). Nothing here ever logs or returns a token in an error message.

import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const FETCH_TIMEOUT_MS = 15_000;

/** Parse `value` as a URL that is https, or http on a loopback host (for local testing). */
export function secureUrl(value, what) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AuthError(`${what} is not a valid URL`);
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url;
  throw new AuthError(`${what} must use https (${url.origin})`);
}

function trimSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/** True when `resource` (from metadata) names `serverUrl` itself or a parent path of it. */
export function resourceMatches(resource, serverUrl) {
  let r;
  let s;
  try {
    r = new URL(resource);
    s = new URL(serverUrl);
  } catch {
    return false;
  }
  if (r.origin !== s.origin) return false;
  const rp = trimSlash(r.pathname);
  const sp = trimSlash(s.pathname);
  return rp === sp || rp === '' || sp.startsWith(`${rp}/`);
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createPkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

export function randomState() {
  return base64url(crypto.randomBytes(24));
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cleanCode(value) {
  return String(value || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'unknown_error';
}

async function fetchJson(fetchImpl, url, init = {}) {
  const res = await fetchImpl(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init.headers || {}) },
    signal: init.signal || AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { res, body };
}

/** RFC 9728: find and check the server's protected-resource metadata. */
export async function discoverProtectedResource(serverUrl, challengeUrl, fetchImpl = fetch) {
  const server = new URL(serverUrl);
  const candidates = [];
  if (challengeUrl) candidates.push(secureUrl(challengeUrl, 'resource_metadata').href);
  const pathPart = trimSlash(server.pathname);
  if (pathPart) candidates.push(`${server.origin}/.well-known/oauth-protected-resource${pathPart}`);
  candidates.push(`${server.origin}/.well-known/oauth-protected-resource`);

  for (const url of [...new Set(candidates)]) {
    let got;
    try {
      got = await fetchJson(fetchImpl, url);
    } catch {
      continue;
    }
    const meta = got.body;
    if (!got.res.ok || !meta || typeof meta !== 'object') continue;
    if (typeof meta.resource !== 'string' || !resourceMatches(meta.resource, serverUrl)) {
      throw new AuthError(`Protected-resource metadata at ${url} is for a different server`);
    }
    if (!Array.isArray(meta.authorization_servers) || !meta.authorization_servers.length) {
      throw new AuthError('The server does not name an authorization server');
    }
    return meta;
  }
  throw new AuthError(`Could not find the server's sign-in details (protected-resource metadata) for ${server.origin}`);
}

/** RFC 8414 / OpenID discovery for `issuer`, checked as MCP requires. */
export async function discoverAuthServer(issuer, fetchImpl = fetch) {
  const url = secureUrl(issuer, 'Authorization server');
  const pathPart = trimSlash(url.pathname);
  const candidates = pathPart
    ? [
        `${url.origin}/.well-known/oauth-authorization-server${pathPart}`,
        `${url.origin}/.well-known/openid-configuration${pathPart}`,
        `${url.origin}${pathPart}/.well-known/openid-configuration`,
      ]
    : [`${url.origin}/.well-known/oauth-authorization-server`, `${url.origin}/.well-known/openid-configuration`];

  for (const candidate of candidates) {
    let got;
    try {
      got = await fetchJson(fetchImpl, candidate);
    } catch {
      continue;
    }
    const meta = got.body;
    if (!got.res.ok || !meta || typeof meta !== 'object') continue;
    if (typeof meta.issuer !== 'string' || trimSlash(meta.issuer) !== trimSlash(issuer)) {
      throw new AuthError('Authorization server metadata names a different issuer');
    }
    secureUrl(meta.authorization_endpoint, 'authorization_endpoint');
    secureUrl(meta.token_endpoint, 'token_endpoint');
    const methods = meta.code_challenge_methods_supported;
    if (!Array.isArray(methods) || !methods.includes('S256')) {
      throw new AuthError('The authorization server does not support PKCE S256; refusing to sign in');
    }
    return meta;
  }
  throw new AuthError(`Could not read the authorization server metadata for ${issuer}`);
}

/** RFC 7591 registration as a public native client with a loopback redirect. */
export async function registerClient(meta, { redirectUri, scope, clientName, version }, fetchImpl = fetch) {
  if (!meta.registration_endpoint) {
    throw new AuthError(
      'This server does not allow automatic client registration. Set FUNAI_API_KEY to use an API key instead.',
    );
  }
  const endpoint = secureUrl(meta.registration_endpoint, 'registration_endpoint').href;
  const request = {
    client_name: clientName,
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'native',
    client_uri: 'https://funai.art/mcp',
    software_id: 'funai-mcp',
    software_version: version,
  };
  if (scope) request.scope = scope;
  const { res, body } = await fetchJson(fetchImpl, endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok || !body || typeof body.client_id !== 'string') {
    const code = body && body.error ? cleanCode(body.error) : `HTTP ${res.status}`;
    throw new AuthError(`Client registration was refused (${code})`);
  }
  return {
    client_id: body.client_id,
    client_secret: typeof body.client_secret === 'string' ? body.client_secret : undefined,
    token_endpoint_auth_method: body.token_endpoint_auth_method || 'none',
  };
}

export function buildAuthorizeUrl(meta, { clientId, redirectUri, challenge, state, scope, resource }) {
  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  if (scope) url.searchParams.set('scope', scope);
  url.searchParams.set('resource', resource);
  return url.href;
}

/** POST to the token endpoint. Errors carry the OAuth error code only. */
export async function tokenRequest(tokenEndpoint, client, params, fetchImpl = fetch) {
  const form = new URLSearchParams(params);
  form.set('client_id', client.client_id);
  if (client.client_secret && client.token_endpoint_auth_method === 'client_secret_post') {
    form.set('client_secret', client.client_secret);
  }
  const { res, body } = await fetchJson(fetchImpl, secureUrl(tokenEndpoint, 'token_endpoint').href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok || !body || typeof body.access_token !== 'string') {
    const code = body && body.error ? cleanCode(body.error) : `HTTP ${res.status}`;
    const err = new AuthError(`The token request was refused (${code})`);
    err.oauthError = code;
    err.status = res.status;
    throw err;
  }
  if (body.token_type && String(body.token_type).toLowerCase() !== 'bearer') {
    throw new AuthError('The authorization server issued a token type other than Bearer');
  }
  const expiresIn = Number(body.expires_in);
  return {
    access_token: body.access_token,
    refresh_token: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
    scope: typeof body.scope === 'string' ? body.scope : undefined,
    expires_at: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
  };
}

/** RFC 7009, best effort: used by `funai-mcp logout`. */
export async function revokeToken(revocationEndpoint, client, token, hint, fetchImpl = fetch) {
  const form = new URLSearchParams({ token, token_type_hint: hint, client_id: client.client_id });
  const res = await fetchImpl(secureUrl(revocationEndpoint, 'revocation_endpoint').href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(5_000),
  });
  await res.text().catch(() => '');
  return res.ok;
}

function page(res, status, title, message) {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.end(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(title)}</title>` +
      '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5">' +
      `<h1 style="font-size:1.25rem">${esc(title)}</h1><p>${esc(message)}</p></body></html>`,
  );
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * A one-shot loopback listener for the authorization response, bound to 127.0.0.1 only.
 * It tries `preferredPort` first (so a saved client's redirect URI keeps working) and falls
 * back to a random free port.
 */
export async function startCallbackServer({ preferredPort, timeoutMs = 5 * 60_000 } = {}) {
  const host = '127.0.0.1';
  let server = http.createServer();
  let port;
  try {
    port = await listen(server, preferredPort || 0, host);
  } catch (err) {
    if (!preferredPort) throw err;
    server = http.createServer();
    port = await listen(server, 0, host);
  }

  let expected = null;
  let done = false;
  let timer = null;
  let resolveCode;
  let rejectCode;
  const result = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  result.catch(() => {});
  const finish = (fn, value) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    fn(value);
  };

  server.on('request', (req, res) => {
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    if (req.method !== 'GET' || url.pathname !== '/callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    if (!expected || done) {
      page(res, 400, 'Nothing to finish', 'This sign-in has already finished. You can close this tab.');
      return;
    }
    const q = url.searchParams;
    if (!safeEqual(q.get('state'), expected.state)) {
      page(res, 400, 'Sign-in not recognised', 'This sign-in was not started by funai-mcp. Go back to your assistant and try again.');
      return;
    }
    const iss = q.get('iss');
    if (iss !== null ? trimSlash(iss) !== trimSlash(expected.issuer) : expected.issRequired) {
      page(res, 400, 'Sign-in refused', 'The sign-in answer came from an unexpected server. Nothing was saved.');
      finish(rejectCode, new AuthError('The authorization response failed the issuer (iss) check'));
      return;
    }
    if (q.get('error')) {
      page(res, 400, 'Sign-in not completed', 'FunAI did not complete the sign-in. Go back to your assistant and try again.');
      finish(rejectCode, new AuthError(`FunAI sign-in was not completed (${cleanCode(q.get('error'))})`));
      return;
    }
    const code = q.get('code');
    if (!code) {
      page(res, 400, 'Sign-in not completed', 'The sign-in answer had no authorization code.');
      finish(rejectCode, new AuthError('The authorization response had no code'));
      return;
    }
    page(res, 200, 'FunAI is connected', 'You can close this tab and go back to your assistant.');
    finish(resolveCode, code);
  });

  return {
    port,
    redirectUri: `http://${host}:${port}/callback`,
    wait({ state, issuer, issRequired }) {
      expected = { state, issuer, issRequired: Boolean(issRequired) };
      timer = setTimeout(
        () => finish(rejectCode, new AuthError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the FunAI sign-in`)),
        timeoutMs,
      );
      return result;
    },
    close() {
      clearTimeout(timer);
      server.close();
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    },
  };
}

/**
 * Open `url` in the system browser without a shell. Resolves true if a browser was launched.
 * Only http(s) URLs are ever passed on.
 */
export function openBrowser(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return Promise.resolve(false);
  let command;
  let args;
  if (process.platform === 'darwin') {
    command = 'open';
    args = [parsed.href];
  } else if (process.platform === 'win32') {
    command = 'rundll32';
    args = ['url.dll,FileProtocolHandler', parsed.href];
  } else {
    command = 'xdg-open';
    args = [parsed.href];
  }
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true, shell: false });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
