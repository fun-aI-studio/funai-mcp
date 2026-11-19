// Saved sign-ins: one JSON file per server URL under ~/.config/funai-mcp/ (directory 0700,
// files 0600). A file holds the registered OAuth client and its tokens, nothing else.
// Several funai-mcp processes (one per client window) can share a file, so a refresh runs
// under a lock file next to it (withLock).

import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// A refresh is one token request (15 s timeout) plus a file write, so a lock older than
// this belongs to a process that died while holding it.
const LOCK_STALE_MS = 30_000;

export function configDir(env = process.env) {
  if (env.FUNAI_MCP_CONFIG_DIR) return env.FUNAI_MCP_CONFIG_DIR;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'funai-mcp');
}

export class TokenStore {
  constructor(serverUrl, dir = configDir()) {
    this.serverUrl = serverUrl;
    this.dir = dir;
    const digest = crypto.createHash('sha256').update(serverUrl).digest('hex').slice(0, 32);
    this.file = path.join(dir, `${digest}.json`);
  }

  async load() {
    let raw;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    try {
      const data = JSON.parse(raw);
      return data && data.server === this.serverUrl ? data : null;
    } catch {
      return null;
    }
  }

  async save(data) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.dir, 0o700);
    const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const handle = await fs.open(tmp, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ ...data, server: this.serverUrl }, null, 2));
    } finally {
      await handle.close();
    }
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, this.file);
  }

  /**
   * Run `fn` while holding `<file>.lock`, created with O_EXCL so only one process at a time
   * gets it. A lock older than `staleMs` is taken over. Throws when the lock cannot be had
   * within `waitMs`.
   */
  async withLock(fn, { staleMs = LOCK_STALE_MS, waitMs = staleMs + 10_000 } = {}) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const lock = `${this.file}.lock`;
    const deadline = Date.now() + waitMs;
    for (;;) {
      try {
        const handle = await fs.open(lock, 'wx', 0o600);
        await handle.writeFile(String(process.pid)).finally(() => handle.close());
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
      try {
        const stat = await fs.stat(lock);
        if (Date.now() - stat.mtimeMs > staleMs) {
          await fs.unlink(lock).catch(() => {});
          continue;
        }
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        throw err;
      }
      if (Date.now() > deadline) throw new Error('Another funai-mcp process is holding the sign-in lock');
      await sleep(25 + Math.floor(Math.random() * 50));
    }
    try {
      return await fn();
    } finally {
      await fs.unlink(lock).catch(() => {});
    }
  }

  async clear() {
    try {
      await fs.unlink(this.file);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }
}

/** Delete every saved sign-in. Returns how many were removed. */
export async function clearAll(dir = configDir()) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  let removed = 0;
  for (const name of names) {
    if (/^[0-9a-f]{32}\.json$/.test(name)) {
      await fs.unlink(path.join(dir, name));
      removed += 1;
    }
  }
  return removed;
}
