#!/usr/bin/env node
import { main } from '../src/cli.js';

function exit(code) {
  // Exit once stdout is flushed, so idle keep-alive sockets cannot hold the process open.
  process.stdout.write('', () => process.exit(code));
}

main(process.argv.slice(2)).then(exit, (err) => {
  process.stderr.write(`[funai-mcp] ${err && err.message ? err.message : err}\n`);
  exit(1);
});
