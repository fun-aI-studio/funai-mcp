import readline from 'node:readline';

import { AuthManager } from './auth.js';
import { Bridge } from './bridge.js';
import { AuthError, openBrowser, secureUrl } from './oauth.js';
import { TokenStore, clearAll, configDir } from './store.js';
import { VERSION } from './version.js';

export const DEFAULT_URL = 'https://mcp.funai.art';
const SHUTDOWN_GRACE_MS = 10_000;

export const USAGE = `funai-mcp ${VERSION}
Connects MCP clients that only speak stdio to the FunAI Studio MCP server.

Usage:
  funai-mcp                Run as a stdio MCP server (your MCP client starts this)
  funai-mcp login          Sign in to FunAI in your browser now
  funai-mcp logout         Delete the saved FunAI sign-in for this server
  funai-mcp logout --all   Delete every saved FunAI sign-in
  funai-mcp --help         Show this help
  funai-mcp --version      Show the version

Options:
  --url <url>              Server URL (default: FUNAI_MCP_URL or ${DEFAULT_URL})

Environment:
  FUNAI_API_KEY            Developer API key from https://developers.funai.art/keys.
                           When set, it is sent instead of a browser sign-in and usage
                           bills your developer API balance. Keep it in your MCP client's
                           env settings, never in a project file.
  FUNAI_MCP_URL            Server URL (default ${DEFAULT_URL})
  FUNAI_MCP_NO_BROWSER=1   Print the sign-in link instead of opening a browser
  FUNAI_MCP_CONFIG_DIR     Where sign-ins are saved (default ~/.config/funai-mcp)
  FUNAI_MCP_DEBUG=1        More logging (stderr only)

Without FUNAI_API_KEY, the first request opens your browser to sign in to FunAI and pick a
spending limit. Generations then spend your FunAI credits. Logs go to stderr; stdout carries
only MCP messages.

Docs: https://docs.funai.art/api/mcp   Support: support@funsoltech.com
`;

function makeLogger(env) {
  const debug = env.FUNAI_MCP_DEBUG === '1';
  const log = (message) => process.stderr.write(`[funai-mcp] ${message}\n`);
  log.debug = debug ? log : () => {};
  return log;
}

function parseArgs(argv) {
  const out = { command: 'run', all: false, url: null, help: false, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h' || arg === 'help') out.help = true;
    else if (arg === '--version' || arg === '-v') out.version = true;
    else if (arg === '--all') out.all = true;
    else if (arg === '--url') {
      out.url = argv[i + 1];
      i += 1;
      if (!out.url) throw new Error('--url needs a value');
    } else if (arg.startsWith('--url=')) out.url = arg.slice('--url='.length);
    else if ((arg === 'login' || arg === 'logout') && out.command === 'run') out.command = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function canonicalServerUrl(value) {
  const url = secureUrl(value, 'FUNAI_MCP_URL');
  url.hash = '';
  const text = url.href;
  return url.pathname === '/' && !url.search ? text.slice(0, -1) : text;
}

export async function main(argv, env = process.env) {
  const log = makeLogger(env);
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  let serverUrl;
  try {
    serverUrl = canonicalServerUrl(args.url || env.FUNAI_MCP_URL || DEFAULT_URL);
  } catch (err) {
    log(err.message);
    return 2;
  }

  const dir = configDir(env);
  const store = new TokenStore(serverUrl, dir);
  const noBrowser = env.FUNAI_MCP_NO_BROWSER === '1';
  const auth = new AuthManager({
    serverUrl,
    apiKey: env.FUNAI_API_KEY ? env.FUNAI_API_KEY.trim() : null,
    store,
    log,
    openUrl: noBrowser ? async () => false : openBrowser,
  });

  if (args.command === 'logout') {
    if (args.all) {
      const n = await clearAll(dir);
      log(n ? `Deleted ${n} saved FunAI sign-in${n === 1 ? '' : 's'}.` : 'No saved FunAI sign-ins.');
    } else {
      const removed = await auth.logout();
      log(removed ? `Signed out of ${serverUrl}.` : `No saved sign-in for ${serverUrl}.`);
    }
    return 0;
  }

  if (args.command === 'login') {
    if (auth.apiKey) {
      log('FUNAI_API_KEY is set, so no browser sign-in is needed.');
      return 0;
    }
    try {
      await auth.login();
      return 0;
    } catch (err) {
      log(err instanceof AuthError ? err.message : `Sign-in failed: ${err.message}`);
      return 1;
    }
  }

  return runBridge({ serverUrl, auth, log });
}

function runBridge({ serverUrl, auth, log }) {
  const bridge = new Bridge({
    serverUrl,
    auth,
    log,
    userAgent: `funai-mcp/${VERSION} (node ${process.version})`,
    write: (message) => process.stdout.write(`${JSON.stringify(message)}\n`),
  });
  log.debug(`Bridging stdio to ${serverUrl}${auth.apiKey ? ' with FUNAI_API_KEY' : ''}.`);

  return new Promise((resolve) => {
    let stopping = false;
    const stop = async (graceMs) => {
      if (stopping) return;
      stopping = true;
      await bridge.close(graceMs);
      resolve(0);
    };
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
    rl.on('line', (line) => {
      bridge.handleLine(line);
    });
    rl.on('close', () => stop(SHUTDOWN_GRACE_MS));
    process.once('SIGINT', () => stop(0));
    process.once('SIGTERM', () => stop(0));
    process.stdout.on('error', (err) => {
      if (err.code === 'EPIPE') stop(0);
    });
  });
}
