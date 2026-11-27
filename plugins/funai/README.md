# FunAI for Claude

Type `/` in Claude and pick a FunAI command: make an image or a video, remove a background,
upscale, swap a face, make a voiceover, music or a 3D model, or browse ready-made presets.

The plugin adds the commands below and connects the FunAI MCP server (`https://mcp.funai.art`).
You sign in on funai.art and choose a spending limit. FunAI's connection needs a paid FunAI plan
or at least 10,000 credits. Every command shows the price first and runs only after you agree.

## Add it

**Claude (web and desktop app)**

1. Open **Customize > Plugins** and choose **Add > Add marketplace**.
2. Enter `fun-ai-studio/funai-mcp`, then add **FunAI Studio**.
3. On the plugin's **Connectors** tab, choose **Add** (or **Connect**) and sign in.
4. In a chat, type `/funai`.

**Claude Code**

```text
/plugin marketplace add fun-ai-studio/funai-mcp
/plugin install funai-studio@funai
```

Then run `/mcp`, choose `funai` and **Authenticate**. Type `/funai-studio:` for the commands.

## Commands

| Create | Edit | People and voices | Ideas | Your account |
| --- | --- | --- | --- | --- |
| `image` | `edit-image` | `face-swap` | `presets` | `menu` |
| `video` | `edit-video` | `try-on` | `product-video` | `credits` |
| `animate-photo` | `remove-background` | `lip-sync` | `storyboard` | `my-creations` |
| `voice` | `replace-background` | `talking-avatar` | `tools` | `video-editor` |
| `music` | `remove-object` | | | `workflows` |
| `sound-effects` | `upscale` | | | |
| `3d-model` | `restore-photo` | | | |

## What it runs, sends and stores

- **It runs nothing on your computer.** The plugin is instructions (skills) plus one remote MCP server, `https://mcp.funai.art`. It has no hooks, scripts, binaries or packages.
- **It sends what you ask for to FunAI, and nothing else.** Your request, the prompt Claude writes for it, and any file you choose to add go to `mcp.funai.art`. Files go through an upload page that you open yourself. FunAI runs the job with the provider of the model you picked and returns the result to the chat. The plugin itself sends nothing anywhere else.
- **It acts as you.** You sign in on funai.art with OAuth and choose a spending limit. Claude gets a token that works only on `mcp.funai.art`; you can disconnect it at any time under Studio > Settings > Connected apps.
- **What FunAI keeps:** your results and uploads stay in your FunAI account until you delete them. FunAI checks requests with its content moderation. FunAI does not sell your prompts, uploads or results. See the [privacy policy](https://funai.art/privacy) and [terms](https://funai.art/terms).

## If it does not work

- **No commands after `/`:** check that the plugin is on under Customize > Plugins. The
  connector alone adds no commands.
- **Tools are blocked:** open Customize > Connectors > FunAI > Permissions and choose "Needs
  approval". On a Team or Enterprise plan, an Owner may have to change it.
- **FunAI is off in this chat:** open + > Connectors and turn it on.

Help: https://funai.art/mcp

Support: support@funsoltech.com · [funai.art/contact](https://funai.art/contact)
