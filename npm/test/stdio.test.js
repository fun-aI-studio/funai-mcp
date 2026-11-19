import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { TokenStore } from '../src/store.js';
import { startMcpServer } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/funai-mcp.js', import.meta.url));
let mcp;
let dir;

before(async () => {
  mcp = await startMcpServer({ tokens: ['Bearer secret-test-key'] });
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'funai-mcp-stdio-'));
});
after(async () => {
  await mcp.close();
});

function spawnCli(args, env = {}) {
  const child = spawn(process.execPath, [BIN, ...args], {
    env: { PATH: process.env.PATH, HOME: dir, FUNAI_MCP_CONFIG_DIR: path.join(dir, 'cfg'), ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const result = { stdout: '', stderr: '', code: null };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => {
    result.stderr += d;
  });
  const done = new Promise((resolve) => {
    child.on('close', (code) => {
      result.code = code;
      resolve(result);
    });
  });
  return { child, result, done };
}

test('stdio round trip: one JSON line per message, DELETE when stdin ends', async () => {
  const start = mcp.requests.length;
  const { child, result, done } = spawnCli([], { FUNAI_MCP_URL: mcp.url, FUNAI_API_KEY: 'secret-test-key' });
  const out = [];
  let buffer = '';
  const send = (m, eol = '\n') => child.stdin.write(JSON.stringify(m) + eol);

  child.stdout.on('data', (chunk) => {
    result.stdout += chunk;
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const msg = JSON.parse(line);
      out.push(msg);
      if (msg.id === 1) {
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      } else if (msg.id === 2) {
        send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { region: 'us' } } }, '\r\n');
      } else if (msg.id === 3) {
        child.stdin.end();
      }
    }
  });
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } },
  });

  const { code, stderr, stdout } = await done;
  assert.equal(code, 0, stderr);
  for (const line of stdout.trim().split('\n')) assert.doesNotThrow(() => JSON.parse(line), line);
  assert.deepEqual(
    out.map((m) => m.id ?? m.method),
    [1, 2, 'notifications/progress', 3],
  );
  assert.equal(out[3].result.content[0].text, '{"region":"us"}');
  assert.doesNotMatch(stderr, /secret-test-key/);
  const seen = mcp.requests.slice(start);
  assert.equal(seen.at(-1).method, 'DELETE');
  assert.equal(seen.find((r) => r.body && r.body.id === 3).headers['mcp-param-region'], 'us');
});

test('--help prints usage and --version the version', async () => {
  const help = spawnCli(['--help']);
  help.child.stdout.on('data', (d) => {
    help.result.stdout += d;
  });
  help.child.stdin.end();
  const h = await help.done;
  assert.equal(h.code, 0);
  assert.match(h.stdout, /Usage:/);
  assert.match(h.stdout, /FUNAI_API_KEY/);

  const version = spawnCli(['--version']);
  version.child.stdout.on('data', (d) => {
    version.result.stdout += d;
  });
  version.child.stdin.end();
  const v = await version.done;
  assert.match(v.stdout, /^\d+\.\d+\.\d+\n$/);
});

test('logout deletes the saved sign-in for the server', async () => {
  const cfg = path.join(dir, 'cfg');
  const store = new TokenStore('https://mcp.funai.art', cfg);
  await store.save({ tokens: { access_token: 'a' } });
  const { child, done } = spawnCli(['logout']);
  child.stdin.end();
  const r = await done;
  assert.equal(r.code, 0, r.stderr);
  assert.equal(await store.load(), null);
  assert.match(r.stderr, /Signed out/);
});

test('a plain-http server URL that is not loopback is refused', async () => {
  const { child, done } = spawnCli([], { FUNAI_MCP_URL: 'http://mcp.example.com' });
  child.stdin.end();
  const r = await done;
  assert.equal(r.code, 2);
  assert.match(r.stderr, /https/);
});

test('an unknown argument exits 2 with usage', async () => {
  const { child, done } = spawnCli(['--nope']);
  child.stdin.end();
  const r = await done;
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Unknown argument/);
});
