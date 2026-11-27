# Changelog

## 2.0.1 - 2026-11-27

- Plugin README: what the plugin runs, sends and stores, for the Claude directory review.

## 2.0.0 - 2026-11-25

- The Claude plugin is now `funai` (it was `funai-studio`) and lives in `plugins/funai`. Its 27
  skills are commands: `/funai:menu`, `/funai:image`, `/funai:remove-background` and more. They
  show in the `/` menu of Claude chat, Cowork and Claude Code. An installed `funai-studio` moves
  over through the marketplace's `renames` map; if Claude Code asks, run
  `/plugin install funai@funai` once.
- README: the plugin in the Claude app, an "Add FunAI to Claude" link, and what to do when tools
  are blocked or no commands show.
- Server 1.2.0: `show_menu` (a menu you can click), an upload page for files you have on your
  device, and the same commands as Skills over MCP.

## 1.2.1 - 2026-11-20

- README: setup for Codex, OpenCode (1 and 2) and Gemini CLI. Codex and OpenCode 2 pin the
  OAuth callback port, because FunAI's sign-in checks the redirect address exactly.
- `gemini-extension.json`: the repository installs as a Gemini CLI extension with the remote
  server and the skills (`gemini extensions install https://github.com/fun-aI-studio/funai-mcp`).

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
