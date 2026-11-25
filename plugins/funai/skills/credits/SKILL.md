---
name: credits
description: Show the person's FunAI credits, or what something would cost.
license: MIT
---

# My credits

1. Call `get_credit_balance` and say it in credits and dollars ($1 = 10,000 credits).
2. For a price, call `estimate_cost`, or read it from `list_models`.
3. The spending limit of this connection is under Studio > Settings > Connected apps on funai.art.

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
