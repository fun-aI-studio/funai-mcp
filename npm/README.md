# funai-mcp

A stdio bridge to the [FunAI Studio](https://funai.art/mcp) MCP server, for MCP clients that
can only start local (stdio) servers. Clients with remote MCP support should connect to
`https://mcp.funai.art` directly instead; see https://funai.art/mcp.

The bridge reads JSON-RPC messages from stdin, sends each one to `https://mcp.funai.art`
over Streamable HTTP, and writes every message of the answer (JSON or a server-sent event
stream, including progress notifications) to stdout, one per line. It has no dependencies.

## Use it

Requires Node.js 18 or later. In your MCP client's configuration:

```json
{
  "mcpServers": {
    "funai": { "command": "npx", "args": ["-y", "funai-mcp"] }
  }
}
```

The first request opens your browser to sign in to FunAI. You review the permissions,
choose a spending limit and approve. Generations then spend your FunAI credits. The
sign-in is saved, refreshed automatically and lasts 90 days.

Some clients give a server only a short time to start. If yours gives up during the first
sign-in, sign in beforehand from a terminal:

```bash
npx -y funai-mcp login
```

## Commands

```text
funai-mcp                Run as a stdio MCP server (your MCP client starts this)
funai-mcp login          Sign in to FunAI in your browser now
funai-mcp logout         Delete the saved FunAI sign-in for this server
funai-mcp logout --all   Delete every saved FunAI sign-in
funai-mcp --help         Show help
funai-mcp --version      Show the version
```

## Environment

| Variable | Meaning |
| --- | --- |
| `FUNAI_API_KEY` | Optional developer API key from [developers.funai.art/keys](https://developers.funai.art/keys). When set, it is sent instead of a browser sign-in, and usage bills your developer API balance. |
| `FUNAI_MCP_URL` | Server URL. Default `https://mcp.funai.art`. Must be https. |
| `FUNAI_MCP_NO_BROWSER=1` | Print the sign-in link to stderr instead of opening a browser. |
| `FUNAI_MCP_CONFIG_DIR` | Where sign-ins are saved. Default `~/.config/funai-mcp` (or `$XDG_CONFIG_HOME/funai-mcp`). |
| `FUNAI_MCP_DEBUG=1` | More logging on stderr. |

Keep an API key in your environment or your client's secret settings. Never put it in a
project file or commit it.

## How sign-in works

1. The server answers the first request with `401` and points to its protected-resource
   metadata (RFC 9728), which names FunAI's authorization server.
2. The bridge reads the authorization server metadata (RFC 8414), checks that it supports
   PKCE S256, and registers itself as a public native client (RFC 7591) with a loopback
   redirect `http://127.0.0.1:<port>/callback`.
3. It opens your browser at the authorization page with PKCE S256, a random `state` and
   `resource=https://mcp.funai.art` (RFC 8707), and listens on 127.0.0.1 only, for up to
   5 minutes.
4. The answer must carry the right `state` and, when the server promises one, the right
   `iss` (RFC 9207). The code is then exchanged for tokens.
5. Tokens are saved in `~/.config/funai-mcp/` (folder `0700`, file `0600`), one file per
   server URL. When the access token expires, or on a `401`, the bridge refreshes them
   (rotating the refresh token) and retries once. Several `funai-mcp` processes can share
   the file: a refresh runs under a lock file and picks up tokens another process already
   refreshed, so a rotated refresh token is never sent twice.
6. If FunAI refuses the refresh (the connection was removed in Connected apps, or it
   expired), the bridge signs you in again in the browser and revokes the old refresh
   token. If FunAI cannot be reached or has an outage, that request fails and the saved
   sign-in is kept for the next one.

The bridge never prints tokens or keys. Logs go to stderr only; stdout carries only MCP
messages. It sends no telemetry.

## Protocol details

- Sends `Accept: application/json, text/event-stream`, the `Mcp-Session-Id` the server
  issued, and `MCP-Protocol-Version` from the negotiated `initialize` result (or from a
  message's `_meta` for 2026-07-28 requests).
- Adds `Mcp-Method`, `Mcp-Name` and the `Mcp-Param-*` headers that tools declare with
  `x-mcp-header` (MCP 2026-07-28), with Base64 encoding where needed. Tools with invalid
  `x-mcp-header` annotations are left out of `tools/list`, as the specification requires.
- An expired session is replaced by replaying your client's `initialize`, then the request is
  retried once. Nothing else is retried, so a paid call is never sent twice.
- `notifications/cancelled` closes the open stream for that request.
- When stdin closes, requests still running get up to 10 seconds, then the session is ended
  with `DELETE`.

## Develop

```bash
npm test
```

The tests use `node:test` with a mock MCP server and a mock authorization server, and need
no network access.

## License

MIT. Support: support@funsoltech.com, https://funai.art/contact.
