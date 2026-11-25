---
name: presets
description: Browse FunAI's ready-made presets and trends, such as Halloween or fashion shoots.
license: MIT
---

# Browse presets

1. Call `list_categories` with `kind: "presets"` and show the trending collections by name.
2. When they choose one, call `resolve_command` with its command to see its presets, then with the preset.
3. Ask for what the preset needs, say the price, and run it with `apply_template` once they agree.

## Always

- Speak in names and prices, never ids. Say what a run costs and wait for a yes before it spends
  credits. A run is billed once: never repeat one after a timeout, look in `list_generations`.
- A photo, clip or audio file must reach FunAI as a public https link. If they attached it or it
  is on their computer, call `upload_file` with no arguments and give them the upload link it
  returns; when they say it is done, call `upload_file` with the `upload_id`. With a shell you can
  upload it yourself (give `filename`, `mime_type` and `size_bytes`).
- `status: NEEDS_MODEL_CHOICE` is a question, not an error: show the options by name and price.
- A `job_id` means it is still being made: follow it with `get_job_status`.
- Show the result itself, with its FunAI link. Results get a shareable link unless
  `private: true` is passed.

## If the FunAI tools are missing or refused

FunAI's tools (`show_menu`, `resolve_command`, `generate_image` and more) come from the FunAI
connector. Some clients load tools on demand, so search for them first. If one is still missing
or refused, stop and tell the person in one or two plain sentences. Do not make the result
another way unless they ask.

- **Not connected:** in Claude, open Customize > Plugins > FunAI > Connectors, choose Add or
  Connect, and sign in. In Claude Code, run `/mcp`, choose `funai`, then Authenticate. Other
  apps: https://funai.art/mcp
- **Off in this chat:** in Claude, open + > Connectors and turn FunAI on.
- **Blocked:** in Claude, open Customize > Connectors > FunAI > Permissions and set the tools to
  "Needs approval" (read-only tools can be "Always allow"). On a Team or Enterprise plan an
  Owner may have to change it.
- **`MCP_PAID_REQUIRED`:** show the link in the answer exactly as given. FunAI's connection
  needs a paid plan or at least 10,000 credits.
