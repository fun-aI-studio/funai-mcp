import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SseParser, collectHeaderParams, encodeHeaderValue, headerValueFor, parseWwwAuthenticate } from '../src/http.js';

test('header values follow the 2026-07-28 encoding table', () => {
  assert.equal(encodeHeaderValue('us-west1'), 'us-west1');
  assert.equal(encodeHeaderValue('Hello, 世界'), '=?base64?SGVsbG8sIOS4lueVjA==?=');
  assert.equal(encodeHeaderValue(' padded '), '=?base64?IHBhZGRlZCA=?=');
  assert.equal(encodeHeaderValue('line1\nline2'), '=?base64?bGluZTEKbGluZTI=?=');
  assert.equal(encodeHeaderValue('=?base64?literal?='), '=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=');
});

test('only strings, booleans and safe integers become header values', () => {
  assert.equal(headerValueFor('x'), 'x');
  assert.equal(headerValueFor(true), 'true');
  assert.equal(headerValueFor(false), 'false');
  assert.equal(headerValueFor(42), '42');
  assert.equal(headerValueFor(-7), '-7');
  assert.equal(headerValueFor(1.5), undefined);
  assert.equal(headerValueFor(2 ** 60), undefined);
  assert.equal(headerValueFor(null), undefined);
  assert.equal(headerValueFor({ a: 1 }), undefined);
});

test('SSE parser joins data lines and survives any chunking', () => {
  const stream = ': comment\r\n\r\nevent: message\r\ndata: {"a":\r\ndata: 1}\r\n\r\nid: 7\ndata: two\n\n';
  for (let size = 1; size <= stream.length; size += 1) {
    const events = [];
    const parser = new SseParser((e) => events.push(e));
    for (let i = 0; i < stream.length; i += size) parser.push(stream.slice(i, i + size));
    parser.end();
    assert.deepEqual(events, [
      { event: 'message', data: '{"a":\n1}' },
      { event: 'message', data: 'two' },
    ]);
  }
});

test('SSE parser keeps the event type', () => {
  const events = [];
  const parser = new SseParser((e) => events.push(e));
  parser.push('event: ping\ndata: x\n\n');
  assert.deepEqual(events, [{ event: 'ping', data: 'x' }]);
});

test('x-mcp-header annotations are collected and checked', () => {
  const ok = collectHeaderParams({
    type: 'object',
    properties: {
      region: { type: 'string', 'x-mcp-header': 'Region' },
      opts: { type: 'object', properties: { dry: { type: 'boolean', 'x-mcp-header': 'Dry-Run' } } },
      'x-mcp-header': { type: 'string' },
    },
  });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.params, [
    { path: ['region'], header: 'Region' },
    { path: ['opts', 'dry'], header: 'Dry-Run' },
  ]);

  const cases = [
    { properties: { size: { type: 'number', 'x-mcp-header': 'Size' } } },
    { properties: { a: { type: 'string', 'x-mcp-header': 'Bad Name' } } },
    { properties: { a: { type: 'string', 'x-mcp-header': '' } } },
    { properties: { a: { type: 'string', 'x-mcp-header': 'X' }, b: { type: 'string', 'x-mcp-header': 'x' } } },
    { properties: { list: { type: 'array', items: { type: 'string', 'x-mcp-header': 'Item' } } } },
    { properties: { one: { oneOf: [{ type: 'string', 'x-mcp-header': 'One' }] } } },
  ];
  for (const schema of cases) assert.equal(collectHeaderParams({ type: 'object', ...schema }).valid, false, JSON.stringify(schema));
  assert.deepEqual(collectHeaderParams(undefined), { valid: true, reason: null, params: [] });
});

test('WWW-Authenticate parameters are parsed', () => {
  const parsed = parseWwwAuthenticate(
    'Bearer realm="FunAI MCP", resource_metadata="https://mcp.funai.art/.well-known/oauth-protected-resource", scope="generate read", error=insufficient_scope',
  );
  assert.equal(parsed.scheme, 'Bearer');
  assert.equal(parsed.params.resource_metadata, 'https://mcp.funai.art/.well-known/oauth-protected-resource');
  assert.equal(parsed.params.scope, 'generate read');
  assert.equal(parsed.params.error, 'insufficient_scope');
  assert.equal(parseWwwAuthenticate(null), null);
});
