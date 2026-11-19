<p align="center"><img src="assets/logo.svg" alt="FunAI" width="72" height="72"></p>

# FunAI Studio MCP server

Generate images, video, audio, 3D and text with hundreds of AI models, Tools and templates,
from your AI assistant.

FunAI runs a remote [Model Context Protocol](https://modelcontextprotocol.io) server at
**`https://mcp.funai.art`**. Connect it to Claude, Cursor, VS Code or any MCP client, then ask
for an image, a video, a voiceover, music, a 3D asset or text. The result comes back in the
same conversation, made on your FunAI account.

This repository holds what the assistant directories need: plugin manifests for Cursor and
Claude Code, [Agent Skills](skills/) that teach an assistant to use FunAI well, the
[`funai-mcp`](npm/) stdio bridge for clients without remote MCP support, and the
[MCP Registry](https://registry.modelcontextprotocol.io) entry ([`server.json`](server.json)).
The server itself is not in this repository.

- Setup page: https://funai.art/mcp
- Documentation: https://docs.funai.art/api/mcp

## What you can do

- **Hundreds of models.** Browse the catalog with prices, read a model's exact inputs and run
  it with every option it has.
- **Your own media as input.** Animate a photo, edit an image, lip-sync a clip, restyle a
  video. Pass a public link, or upload a file from your computer.
- **FunAI Tools and templates.** One-shot results such as product shots, face swap, upscale,
  background removal and trend templates.
- **Long jobs handled.** Video renders report progress. The assistant can check status, list
  your past generations and stop a queued job.
- **Video editor.** With the FunAI editor open in your browser, the assistant can edit your
  timeline, and it can render a saved project on the server.
- **Spending you control.** You choose a spending limit when you connect. Paid tools are
  marked so your client asks before running them. They are never retried, and each run is
  billed once.

## Connect

Every client below needs only the URL `https://mcp.funai.art`. It finds FunAI's sign-in on
its own. You sign in on funai.art, review the permissions, choose a spending limit, and
approve. There is no API key to create or paste.

### Claude (claude.ai and Claude Desktop)

1. Open **Settings > Connectors > Add custom connector**.
2. Name it `FunAI` and enter `https://mcp.funai.art`.
3. Sign in to FunAI, review the permissions, pick a spending limit, then choose **Allow**.

### Claude Code

```bash
claude mcp add --transport http funai https://mcp.funai.art
```

Then run `/mcp` in Claude Code, select `funai` and choose **Authenticate**.

To get the server together with the FunAI skills, install the plugin from this repository:

```text
/plugin marketplace add fun-aI-studio/funai-mcp
/plugin install funai-studio@funai
```

### Cursor

[**Add FunAI to Cursor**](https://cursor.com/install-mcp?name=funai&config=eyJ1cmwiOiJodHRwczovL21jcC5mdW5haS5hcnQifQ%3D%3D)
(or open `cursor://anysphere.cursor-deeplink/mcp/install?name=funai&config=eyJ1cmwiOiJodHRwczovL21jcC5mdW5haS5hcnQifQ%3D%3D`).

Or add this to `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "funai": { "url": "https://mcp.funai.art" } } }
```

Open **Settings > MCP**. FunAI shows **Needs login**: click it and sign in. This repository is
also a Cursor plugin (`.cursor-plugin/plugin.json`) that adds the server and the skills.

### VS Code

[**Install FunAI in VS Code**](https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522funai%2522%252C%2522type%2522%253A%2522http%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fmcp.funai.art%2522%257D)

Or run **MCP: Add Server...** and choose HTTP, or add this to your `mcp.json`:

```json
{ "servers": { "funai": { "type": "http", "url": "https://mcp.funai.art" } } }
```

VS Code asks you to sign in to FunAI the first time the server starts. Use FunAI from the
**Agent** mode of Copilot Chat.

### ChatGPT

Coming soon.

### Any other MCP client

Give it the URL `https://mcp.funai.art` (Streamable HTTP). A client with MCP OAuth support
needs nothing else.

### Clients that only run local (stdio) servers

Use the [`funai-mcp`](npm/) bridge. It runs on your computer, relays to
`https://mcp.funai.art`, and opens your browser to sign in the first time:

```json
{
  "mcpServers": {
    "funai": { "command": "npx", "args": ["-y", "funai-mcp"] }
  }
}
```

Requires Node.js 18 or later. See [npm/README.md](npm/README.md) for options.

### Scripts and API keys

A script or CI job that cannot sign in through a browser can use a developer API key from
[developers.funai.art/keys](https://developers.funai.art/keys), sent as
`Authorization: Bearer <key>` (or as `FUNAI_API_KEY` for the stdio bridge).

- Read the key from an **environment variable**.
- Never paste it into a project file, a committed `mcp.json` or a repository.

```bash
curl https://mcp.funai.art \
  -H "Authorization: Bearer $FUNAI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"my-script","version":"1.0"}}}'
```

`initialize` returns an `Mcp-Session-Id` header. Send it on every later request, and send
`DELETE` with it when you are done.

## Tools

The live list, with input schemas and annotations, is at
[mcp.funai.art/tools.json](https://mcp.funai.art/tools.json) and through MCP `tools/list`.
Paid tools are marked `readOnlyHint: false`, so clients ask before running them.

| Area | Tools | Cost |
| --- | --- | --- |
| Find models and prices | `list_models`, `get_model_schema`, `estimate_cost` | free |
| Your account | `get_credit_balance`, `list_generations`, `get_job_status` | free |
| Generate | `generate_image`, `generate_video`, `generate_audio`, `generate_3d`, `generate_text` | spends credits |
| Any model, every option | `run_model` | spends credits |
| FunAI Tools and templates | `list_tools`, `list_templates` (free); `run_tool`, `apply_template` | spends credits |
| Your files as input | `upload_file` | free (uses storage) |
| Stop a job | `cancel_job` | free while queued; full price once started, and only after you agree |
| Video editor | `editor_sessions`, `editor_commands` (free); `editor_run` | billed commands spend credits |
| Server render | `render_project`; `render_status` (free) | spends credits |

The server also offers resources (`funai://guide`, `funai://models/{model_id}`,
`funai://jobs/{job_id}`) and prompts (`product-video`, `storyboard`, `edit-photo`).

Results get a shareable funai.art link that opens without signing in. Ask for a result to be
private and the assistant passes `private: true`. Uploaded input files stay private to your
account.

## Models and prices

You pick models by name. The assistant shows names and prices and never asks you for an id.
A few examples from the catalog on 2026-11-19 ($1 = 10,000 credits):

| Model | Kind | Price per run |
| --- | --- | --- |
| FLUX 2 Flash | Image | about $0.005 |
| FLUX 2 | Image | about $0.013 |
| Seedream V4.5 | Image | about $0.04 |
| Nano Banana 2 | Image editing | about $0.08 |
| GPT Image 2 | Image | from about $0.01, depending on size and quality |
| Seedance v1 Pro Fast | Video | about $0.05 |
| Kling Video v3 Standard | Video | from about $0.26, depending on length |
| Veo 3.1 Fast | Video | from about $0.42, depending on length |
| ElevenLabs TTS Turbo v2.5 | Speech | about $0.05 per 1,000 characters |
| Elevenlabs Music | Music | about $0.05 per 5 seconds |
| Elevenlabs Sound Effects V2 | Sound effects | about $0.01 per 5 seconds |
| Sync Lipsync 2.0 | Lip sync | about $0.26 per 5 seconds |
| Tripo P1 | 3D | about $0.05 |

Prices change. The live figures come from `list_models` and `estimate_cost` in your
assistant, and from [funai.art/pricing](https://funai.art/pricing).

## Spending limits and Connected apps

- **Spending limit per connection.** When you connect over OAuth you choose how much that
  connection may spend every 30 days: $5, $10 (the default), $25 or $50, or no limit after a
  warning. When it is reached, paid calls stop with `spend_cap_exceeded` until the window
  rolls over or you raise the limit. Free tools keep working.
- **Permissions.** You approve `read`, `generate`, `editor` and `account:read`, and can switch
  off all but `read`.
- **Connected apps.** In FunAI, **Studio > Settings > Connected apps** lists every connection
  with its permissions, limit and last use. Disconnect there; it takes effect within a minute.
- **Lifetime.** A connection lasts 90 days, then you approve it again.

## Billing

- **Signed in with OAuth:** generations spend your **FunAI credits**, per generation, at
  studio prices. Plan allowances described as "unlimited" do not apply to MCP.
- **With an API key:** usage bills your prepaid **developer API balance**.
- Connecting is free. Stopping a job is free while it is queued; once the provider has
  started it, stopping costs the full price and the result still arrives.

## Privacy and security

- The token a client holds works only on `mcp.funai.art`. It carries that audience, the
  FunAI API refuses it, and it never carries staff or admin permissions.
- Sign-in is OAuth 2.1 with PKCE (S256) and Dynamic Client Registration. You approve every
  connection on funai.art.
- The `funai-mcp` bridge stores its sign-in under `~/.config/funai-mcp/` (folder `0700`,
  files `0600`), writes logs only to stderr, never prints tokens or keys, and sends no
  telemetry.
- Generation results are public links by default so they can be shared; inputs you upload
  are private.
- Privacy policy: https://funai.art/privacy. Terms: https://funai.art/terms.
- To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Skills

[`skills/`](skills/) holds [Agent Skills](https://agentskills.io) that teach an assistant to
use FunAI well: names instead of ids, prices before paid runs, and the right tool for each job.

| Skill | For |
| --- | --- |
| [funai-create-images](skills/funai-create-images/SKILL.md) | Choosing an image model, prompts, edits with masks and references |
| [funai-make-videos](skills/funai-make-videos/SKILL.md) | Text or image to video, start and end frames, length and price, long jobs, stopping |
| [funai-voice-and-music](skills/funai-voice-and-music/SKILL.md) | Speech, music, sound effects, transcription, lip sync |
| [funai-tools-and-templates](skills/funai-tools-and-templates/SKILL.md) | FunAI Tools, templates, uploading local files, any model's full inputs |
| [funai-spend-wisely](skills/funai-spend-wisely/SKILL.md) | Estimates, balance, spending limits, what to do when credits run out |
| [funai-video-editor](skills/funai-video-editor/SKILL.md) | Editing an open FunAI editor project and server renders |

They come with the Claude Code and Cursor plugins. Other ways to add them:

- Any agent that reads skills: `npx skills add fun-aI-studio/funai-mcp`
- claude.ai: zip one skill folder and upload it under **Customize > Skills**.
- Or copy a folder into `.claude/skills/`, `.cursor/skills/`, `.github/skills/` or `.agents/skills/`.

## Repository layout

| Path | What it is |
| --- | --- |
| `.claude-plugin/` | Claude Code plugin (`plugin.json`) and marketplace (`marketplace.json`) |
| `.cursor-plugin/plugin.json` | Cursor plugin manifest |
| `mcp.json`, `.mcp.json` | The remote server config the plugins install |
| `skills/` | Agent Skills |
| `npm/` | The `funai-mcp` stdio bridge |
| `server.json` | MCP Registry entry for `art.funai/studio` |
| `assets/` | Logo |

## Support

- Contact: https://funai.art/contact
- Email: support@funsoltech.com
- Setup page: https://funai.art/mcp
- Documentation: https://docs.funai.art/api/mcp

## License

[MIT](LICENSE)
