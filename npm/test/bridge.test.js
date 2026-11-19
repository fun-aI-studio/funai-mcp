import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

import { AuthManager } from '../src/auth.js';
import { Bridge } from '../src/bridge.js';
import { collector, startMcpServer } from './helpers.js';

let mcp;
before(async () => {
  mcp = await startMcpServer();
});
after(async () => {
  await mcp.close();
});

function keyAuth(key = 'test-key') {
  return new AuthManager({ serverUrl: mcp.url, apiKey: key, store: { load: async () => null } });
}

function makeBridge(auth = keyAuth()) {
  const out = collector();
  const logs = [];
  const bridge = new Bridge({ serverUrl: mcp.url, auth, write: out.write, log: (m) => logs.push(m) });
  return { bridge, out, logs };
}

const init = (id = 1) => JSON.stringify({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
});

test('initialize, session headers, SSE and notifications', async () => {
  const { bridge, out, logs } = makeBridge();
  const start = mcp.requests.length;
  await bridge.handleLine(init());
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  await bridge.handleLine(
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { region: 'eu-west', count: 3, note: 'Hello, 世界' } } }),
  );

  const seen = mcp.requests.slice(start);
  const [first, notified, list, call] = seen;
  assert.equal(first.body.method, 'initialize');
  assert.equal(first.headers.authorization, 'Bearer test-key');
  assert.equal(first.headers.accept, 'application/json, text/event-stream');
  assert.equal(first.headers['content-type'], 'application/json');
  assert.equal(first.headers['mcp-method'], 'initialize');
  assert.equal(first.headers['mcp-protocol-version'], undefined);
  assert.equal(first.headers['mcp-session-id'], undefined);

  const sid = notified.headers['mcp-session-id'];
  assert.match(sid, /^session-\d+$/);
  assert.equal(notified.headers['mcp-protocol-version'], '2025-11-25');
  assert.equal(notified.headers['mcp-method'], 'notifications/initialized');

  assert.equal(list.headers['mcp-session-id'], sid);
  assert.equal(list.headers['mcp-method'], 'tools/list');
  assert.equal(list.headers['mcp-name'], undefined);

  assert.equal(call.headers['mcp-method'], 'tools/call');
  assert.equal(call.headers['mcp-name'], 'echo');
  assert.equal(call.headers['mcp-param-region'], 'eu-west');
  assert.equal(call.headers['mcp-param-count'], '3');

  assert.equal(out.lines[0].id, 1);
  assert.equal(out.lines[0].result.protocolVersion, '2025-11-25');
  const tools = out.lines[1].result.tools.map((t) => t.name);
  assert.deepEqual(tools, ['echo', 'slow'], 'the tool with an invalid x-mcp-header is left out');
  assert.ok(logs.some((l) => l.includes('broken')));
  assert.equal(out.lines[2].method, 'notifications/progress', 'progress comes before the result');
  assert.equal(out.lines[3].id, 3);
  assert.deepEqual(JSON.parse(out.lines[3].result.content[0].text), { region: 'eu-west', count: 3, note: 'Hello, 世界' });
  assert.equal(out.lines.length, 4, 'a 202 notification writes nothing');

  await bridge.close();
  const del = mcp.requests.at(-1);
  assert.equal(del.method, 'DELETE');
  assert.equal(del.headers['mcp-session-id'], sid);
  assert.equal(del.headers['mcp-protocol-version'], '2025-11-25');
});

test('2026-07-28 messages carry the version from _meta and an encoded Mcp-Name', async () => {
  const { bridge, out } = makeBridge();
  const start = mcp.requests.length;
  await bridge.handleLine(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'a',
      method: 'resources/read',
      params: { uri: 'funai://guide é', _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
    }),
  );
  const req = mcp.requests[start];
  assert.equal(req.headers['mcp-protocol-version'], '2026-07-28');
  assert.equal(req.headers['mcp-method'], 'resources/read');
  assert.equal(req.headers['mcp-name'], `=?base64?${Buffer.from('funai://guide é').toString('base64')}?=`);
  assert.equal(req.headers['mcp-session-id'], undefined);
  assert.deepEqual(out.lines, [{ jsonrpc: '2.0', id: 'a', result: {} }]);
  await bridge.close();
  assert.notEqual(mcp.requests.at(-1).method, 'DELETE', 'no session, nothing to delete');
});

test('an expired session is replaced and the request retried once', async () => {
  const { bridge, out } = makeBridge();
  await bridge.handleLine(init(10));
  mcp.state.sessions.clear();
  const start = mcp.requests.length;
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'ping' }));
  const methods = mcp.requests.slice(start).map((r) => r.body && r.body.method);
  assert.deepEqual(methods, ['ping', 'initialize', 'notifications/initialized', 'ping']);
  assert.deepEqual(out.lines.map((m) => m.id), [10, 11], 'the replayed initialize answer is not shown to the client');
  assert.deepEqual(out.lines[1].result, {});
  await bridge.close();
});

test('a rejected API key is reported once, without a retry loop', async () => {
  const { bridge, out } = makeBridge(keyAuth('wrong-key'));
  const start = mcp.requests.length;
  await bridge.handleLine(init(20));
  assert.equal(mcp.requests.length - start, 1);
  assert.equal(out.lines[0].id, 20);
  assert.match(out.lines[0].error.message, /FUNAI_API_KEY/);
  assert.doesNotMatch(JSON.stringify(out.lines), /wrong-key/);
});

test('notifications/cancelled is forwarded and stops the open stream', async () => {
  const { bridge, out } = makeBridge();
  await bridge.handleLine(init(30));
  const call = bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'slow', arguments: {} } }));
  while (!mcp.state.open.size) await new Promise((r) => setTimeout(r, 10));
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 31 } }));
  await call;
  assert.equal(mcp.requests.at(-1).body.method, 'notifications/cancelled');
  assert.deepEqual(out.lines.map((m) => m.id), [30], 'no answer for the cancelled request');
  await bridge.close();
});

test('HTTP errors and bad input become JSON-RPC errors', async () => {
  const { bridge, out } = makeBridge();
  await bridge.handleLine(init(40));
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 41, method: 'boom' }));
  await bridge.handleLine('{not json');
  await bridge.handleLine('[{"jsonrpc":"2.0","id":1,"method":"ping"}]');
  assert.deepEqual(out.lines[1], { jsonrpc: '2.0', id: 41, error: { code: -32603, message: 'FunAI answered HTTP 500' } });
  assert.equal(out.lines[2].error.code, -32700);
  assert.equal(out.lines[3].error.code, -32600);
  await bridge.close();
});

test('an unreachable server is reported on the request', async () => {
  const out = collector();
  const bridge = new Bridge({ serverUrl: 'http://127.0.0.1:9', auth: keyAuth(), write: out.write });
  await bridge.handleLine(init(50));
  assert.equal(out.lines[0].id, 50);
  assert.match(out.lines[0].error.message, /Could not reach FunAI/);
});

test('SSE events that are not one JSON-RPC message are skipped, and the answer still arrives', async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 's1' });
    res.write('data: {"hello":"not jsonrpc"}\n\n');
    res.write('data: [{"jsonrpc":"2.0","method":"x"}]\n\n');
    res.write('data: "a string"\n\n');
    res.write('data: 42\n\n');
    res.write('data: null\n\n');
    res.end('data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25"}}\n\n');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const out = collector();
    const logs = [];
    const bridge = new Bridge({
      serverUrl: `http://127.0.0.1:${srv.address().port}`,
      auth: { authorization: async () => null, apiKey: null },
      write: out.write,
      log: (m) => logs.push(m),
    });
    await bridge.handleLine(init(1));
    assert.deepEqual(out.lines, [{ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } }]);
    assert.equal(logs.filter((l) => l.includes('not one JSON-RPC message')).length, 5);
  } finally {
    srv.closeAllConnections?.();
    srv.close();
  }
});

test('requests sent while a new session starts wait for it, and only one new session starts', async () => {
  let inject = null;
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (inject && body && body.method === 'initialize') {
      const fn = inject;
      inject = null;
      fn();
    }
    return fetch(url, init);
  };
  const out = collector();
  const bridge = new Bridge({ serverUrl: mcp.url, auth: keyAuth(), fetchImpl, write: out.write });
  await bridge.handleLine(init(60));
  const oldSid = bridge.sessionId;

  // (a) B arrives while the replayed initialize is in flight.
  mcp.state.sessions.clear();
  let b;
  inject = () => {
    b = bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 'B', method: 'ping' }));
  };
  const start = mcp.requests.length;
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 'A', method: 'ping' }));
  await b;
  const newSid = bridge.sessionId;
  assert.notEqual(newSid, oldSid);
  const bReq = mcp.requests.slice(start).filter((r) => r.body && r.body.id === 'B');
  assert.deepEqual(bReq.map((r) => r.headers['mcp-session-id']), [newSid], 'B went out once, on the new session');
  const answers = out.lines.filter((m) => m.id === 'A' || m.id === 'B').sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(answers, [{ jsonrpc: '2.0', id: 'A', result: {} }, { jsonrpc: '2.0', id: 'B', result: {} }]);

  // (b) Several requests find the same session gone: one initialize, no abandoned session.
  mcp.state.sessions.clear();
  const start2 = mcp.requests.length;
  const ids = ['C', 'D', 'E'];
  await Promise.all(ids.map((id) => bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }))));
  const inits = mcp.requests.slice(start2).filter((r) => r.body && r.body.method === 'initialize');
  assert.equal(inits.length, 1, 'one new session for all three');
  for (const id of ids) assert.deepEqual(out.lines.find((m) => m.id === id), { jsonrpc: '2.0', id, result: {} });
  await bridge.close();
});
