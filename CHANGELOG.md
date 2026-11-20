# Changelog

## 1.2.0 - 2026-11-20

- Skills: slash commands and funai.art links. `funai-tools-and-templates` covers
  `resolve_command` and `list_categories`, and every other skill sends a typed command such as
  `/remove-background` or `/halloween` there first.
- README: slash commands, catalogue prompts, and the `search_docs` / `read_docs` tools.
- Plugin manifests at 1.2.0. The `funai-mcp` npm bridge is unchanged at 1.1.0.

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
