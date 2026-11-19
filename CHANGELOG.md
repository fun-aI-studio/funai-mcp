# Changelog

## 1.1.0 - 2026-11-19

- `funai-mcp`, a stdio bridge to `https://mcp.funai.art` for clients without remote MCP
  support: browser sign-in (OAuth 2.1 with PKCE, Dynamic Client Registration and the `iss`
  check), saved and refreshed tokens, `FUNAI_API_KEY` for scripts, and `login` / `logout`
  commands. It relays MCP 2025-03-26 to 2025-11-25 sessions and sends the 2026-07-28 request headers.
- Registry entry `server.json` lists the npm package next to the remote server.
- Claude Code plugin and marketplace (`funai-studio@funai`) and a Cursor plugin, both
  installing the remote server and six Agent Skills.

## 1.0.0 - 2026-11-18

- `art.funai/studio` published to the MCP Registry as a remote Streamable HTTP server.
