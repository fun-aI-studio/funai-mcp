import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { AuthManager } from '../src/auth.js';
import { Bridge } from '../src/bridge.js';
import { AuthError, discoverAuthServer, discoverProtectedResource, startCallbackServer } from '../src/oauth.js';
import { TokenStore } from '../src/store.js';
import { collector, fakeBrowser, startAuthServer, startMcpServer } from './helpers.js';

let mcp;
let as;
let dir;

before(async () => {
  mcp = await startMcpServer({ tokens: [] });
  as = await startAuthServer({
    onIssue: (token) => mcp.state.tokens.add(`Bearer ${token}`),
    onRevokeAccess: (token) => mcp.state.tokens.delete(`Bearer ${token}`),
  });
  mcp.state.issuer = as.issuer;
});
after(async () => {
  await mcp.close();
  await as.close();
});
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'funai-mcp-test-'));
  as.opts.iss = undefined;
  as.opts.failRefresh = false;
  as.opts.refreshStatus = 0;
  as.opts.metadata = {};
  mcp.state.protectedResource = null;
});

const ping = (id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' });

async function expireSaved(store) {
  const saved = await store.load();
  saved.tokens.expires_at = Date.now() - 1000;
  await store.save(saved);
  return saved;
}

function setup({ browser = fakeBrowser(), timeoutMs } = {}) {
  const logs = [];
  const store = new TokenStore(mcp.url, path.join(dir, 'funai-mcp'));
  const auth = new AuthManager({
    serverUrl: mcp.url,
    store,
    openUrl: browser.open,
    log: (m) => logs.push(m),
    callbackTimeoutMs: timeoutMs,
  });
  const out = collector();
  const bridge = new Bridge({ serverUrl: mcp.url, auth, write: out.write, log: (m) => logs.push(m) });
  return { auth, store, bridge, out, logs, browser };
}

const init = (id) =>
  JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } });

test('first request runs discovery, DCR and PKCE, then saves tokens privately', async () => {
  const { bridge, out, store, logs, browser } = setup();
  const regs = as.seen.registrations.length;
  await bridge.handleLine(init(1));

  assert.equal(out.lines[0].id, 1);
  assert.ok(out.lines[0].result, JSON.stringify(out.lines[0]));
  assert.equal(browser.opened.length, 1);

  const reg = as.seen.registrations[regs];
  assert.match(reg.redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  assert.equal(reg.application_type, 'native');
  assert.equal(reg.token_endpoint_auth_method, 'none');
  assert.deepEqual(reg.grant_types, ['authorization_code', 'refresh_token']);

  const authz = as.seen.authorizations.at(-1);
  assert.equal(authz.code_challenge_method, 'S256');
  assert.equal(authz.resource, mcp.url);
  assert.equal(authz.scope, 'read generate');
  assert.ok(authz.state.length >= 32);
  const exchange = as.seen.tokens.at(-1);
  assert.equal(exchange.grant_type, 'authorization_code');
  assert.equal(exchange.resource, mcp.url);
  assert.ok(exchange.code_verifier.length >= 43);

  const saved = await store.load();
  assert.ok(saved.tokens.access_token.startsWith('access-'));
  assert.ok(saved.tokens.refresh_token.startsWith('refresh-'));
  assert.equal(saved.resource, mcp.url);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(store.dir)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(store.file)).mode & 0o777, 0o600);
  }
  const logged = logs.join('\n');
  assert.doesNotMatch(logged, /access-|refresh-/, 'tokens never reach the logs');
  await bridge.close();
});

test('a 401 refreshes with rotation and retries without the browser', async () => {
  const { bridge, out, store, browser } = setup();
  await bridge.handleLine(init(1));
  const before = await store.load();
  mcp.state.tokens.delete(`Bearer ${before.tokens.access_token}`);

  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }));
  assert.deepEqual(out.lines[1], { jsonrpc: '2.0', id: 2, result: {} });
  assert.equal(browser.opened.length, 1, 'no second browser sign-in');

  const afterRefresh = await store.load();
  assert.notEqual(afterRefresh.tokens.access_token, before.tokens.access_token);
  assert.notEqual(afterRefresh.tokens.refresh_token, before.tokens.refresh_token, 'the refresh token rotated');
  assert.equal(as.refresh.get(before.tokens.refresh_token).used, true);
  const refreshCall = as.seen.tokens.at(-1);
  assert.equal(refreshCall.grant_type, 'refresh_token');
  assert.equal(refreshCall.resource, mcp.url);
  await bridge.close();
});

test('a saved sign-in is reused by the next process', async () => {
  const first = setup();
  await first.bridge.handleLine(init(1));
  await first.bridge.close();
  const second = setup({ browser: { open: async () => assert.fail('no browser needed'), opened: [] } });
  await second.bridge.handleLine(init(1));
  assert.ok(second.out.lines[0].result);
  await second.bridge.close();
});

test('when the refresh fails, the browser sign-in runs again', async () => {
  const { bridge, out, store, browser } = setup();
  await bridge.handleLine(init(1));
  const saved = await store.load();
  mcp.state.tokens.delete(`Bearer ${saved.tokens.access_token}`);
  as.opts.failRefresh = true;
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }));
  assert.deepEqual(out.lines[1].result, {});
  assert.equal(browser.opened.length, 2);
  const revoked = as.seen.revocations.map((r) => r.token);
  assert.ok(revoked.includes(saved.tokens.refresh_token), 'the replaced sign-in is revoked');
  await bridge.close();
});

test('an expired access token whose refresh is refused signs in through the browser again', async () => {
  const first = setup();
  await first.bridge.handleLine(init(1));
  await first.bridge.close();
  const saved = await expireSaved(first.store);
  mcp.state.tokens.delete(`Bearer ${saved.tokens.access_token}`);
  as.opts.failRefresh = true;

  const { bridge, out, browser } = setup();
  await bridge.handleLine(init(1));
  assert.ok(out.lines[0].result, JSON.stringify(out.lines[0]));
  assert.equal(browser.opened.length, 1, 'the second process signed in again');
  await bridge.close();
});

test('an outage at the authorization server fails the request but keeps the sign-in', async () => {
  const { bridge, out, store, browser } = setup();
  await bridge.handleLine(init(1));
  const saved = await store.load();

  // On a 401 (token rejected before its expiry time).
  mcp.state.tokens.delete(`Bearer ${saved.tokens.access_token}`);
  as.opts.refreshStatus = 503;
  await bridge.handleLine(ping(2));
  assert.equal(out.lines[1].id, 2);
  assert.match(out.lines[1].error.message, /kept/);
  // On expiry.
  await expireSaved(store);
  await bridge.handleLine(ping(3));
  assert.match(out.lines[2].error.message, /kept/);
  assert.equal(browser.opened.length, 1, 'no browser sign-in for an outage');
  assert.equal((await store.load()).tokens.refresh_token, saved.tokens.refresh_token);

  as.opts.refreshStatus = 0;
  await bridge.handleLine(ping(4));
  assert.deepEqual(out.lines[3], { jsonrpc: '2.0', id: 4, result: {} });
  assert.equal(browser.opened.length, 1);
  await bridge.close();
});

test('two processes sharing a sign-in never replay a rotated refresh token', async () => {
  const a = setup();
  await a.bridge.handleLine(init(1));
  const b = setup({ browser: { open: async () => assert.fail('no browser needed'), opened: [] } });
  await b.bridge.handleLine(init(1));
  const start = as.seen.tokens.length;
  const reuseStart = as.seen.reuse.length;

  // Both access tokens expire; A refreshes first, then B.
  for (const p of [a, b]) p.auth.state.tokens.expires_at = Date.now() - 1000;
  await a.bridge.handleLine(ping(2));
  await b.bridge.handleLine(ping(2));
  // Expire again and refresh at the same moment.
  await expireSaved(a.store);
  for (const p of [a, b]) p.auth.state.tokens.expires_at = Date.now() - 1000;
  await Promise.all([a.bridge.handleLine(ping(3)), b.bridge.handleLine(ping(3))]);

  const refreshes = as.seen.tokens.slice(start).filter((f) => f.grant_type === 'refresh_token');
  assert.equal(refreshes.length, 2, 'one refresh per expiry, shared by both processes');
  assert.deepEqual(as.seen.reuse.slice(reuseStart), [], 'no refresh token was replayed, so no grant was revoked');
  for (const p of [a, b]) {
    assert.deepEqual(p.out.lines.slice(1).map((m) => m.result), [{}, {}], JSON.stringify(p.out.lines));
  }
  assert.equal(a.browser.opened.length, 1);
  await a.bridge.close();
  await b.bridge.close();
});

test('the token file lock is exclusive and a stale one is taken over', async () => {
  const store = new TokenStore(mcp.url, path.join(dir, 'funai-mcp'));
  const order = [];
  const hold = (name, ms) =>
    store.withLock(async () => {
      order.push(`${name}+`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${name}-`);
    });
  await Promise.all([hold('a', 50), hold('b', 10)]);
  assert.ok(['a+,a-,b+,b-', 'b+,b-,a+,a-'].includes(order.join(',')), order.join(','));

  await fs.writeFile(`${store.file}.lock`, '12345');
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(`${store.file}.lock`, old, old);
  assert.equal(await store.withLock(async () => 'ran'), 'ran');
  await assert.rejects(fs.stat(`${store.file}.lock`), /ENOENT/, 'the lock is removed afterwards');

  await fs.writeFile(`${store.file}.lock`, '12345');
  await assert.rejects(store.withLock(async () => 'never', { waitMs: 100 }), /lock/);
  await fs.unlink(`${store.file}.lock`);
});

test('an authorization response with the wrong iss is refused and nothing is saved', async () => {
  const { bridge, out, store } = setup();
  as.opts.iss = 'https://evil.example/auth';
  await bridge.handleLine(init(1));
  assert.equal(out.lines[0].id, 1);
  assert.match(out.lines[0].error.message, /iss/);
  assert.equal(await store.load(), null);
});

test('a missing iss is refused when the server promises one', async () => {
  const { bridge, out } = setup();
  as.opts.iss = null;
  // The helper drops the parameter when iss is null.
  await bridge.handleLine(init(1));
  assert.match(out.lines[0].error.message, /iss/);
});

test('the sign-in times out when the browser never comes back', async () => {
  const { bridge, out } = setup({ browser: { open: async () => false, opened: [] }, timeoutMs: 300 });
  await bridge.handleLine(init(1));
  assert.match(out.lines[0].error.message, /Timed out/);
});

test('the callback listens on 127.0.0.1 and ignores answers with another state', async () => {
  const cb = await startCallbackServer({ timeoutMs: 5_000 });
  try {
    assert.match(cb.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const pending = cb.wait({ state: 'expected-state', issuer: 'https://auth.example', issRequired: true });
    const wrong = await fetch(`${cb.redirectUri}?code=x&state=other&iss=https://auth.example`);
    assert.equal(wrong.status, 400);
    await wrong.text();
    const right = await fetch(`${cb.redirectUri}?code=good&state=expected-state&iss=https://auth.example`);
    assert.equal(right.status, 200);
    assert.match(await right.text(), /FunAI is connected/);
    assert.equal(await pending, 'good');
  } finally {
    cb.close();
  }
});

test('metadata for another server or without PKCE S256 is refused', async () => {
  mcp.state.protectedResource = { resource: 'https://other.example', authorization_servers: [as.issuer] };
  await assert.rejects(discoverProtectedResource(mcp.url, null), AuthError);
  mcp.state.protectedResource = null;
  as.opts.metadata = { code_challenge_methods_supported: ['plain'] };
  await assert.rejects(discoverAuthServer(as.issuer), /S256/);
  as.opts.metadata = { issuer: 'https://mixup.example/auth' };
  await assert.rejects(discoverAuthServer(as.issuer), /issuer/);
  await assert.rejects(discoverAuthServer('http://auth.example'), /https/);
});

test('logout revokes the refresh token and deletes the file', async () => {
  const { bridge, store, auth } = setup();
  await bridge.handleLine(init(1));
  await bridge.close();
  const saved = await store.load();
  assert.equal(await auth.logout(), true);
  assert.equal(await store.load(), null);
  const revoked = as.seen.revocations.at(-1);
  assert.equal(revoked.token, saved.tokens.refresh_token);
  assert.equal(revoked.token_type_hint, 'refresh_token');
});
