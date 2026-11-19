---
name: funai-video-editor
description: Edit a project in the FunAI video editor and render saved projects through the FunAI MCP server. Use when the person has the FunAI editor open in their browser and asks you to cut, arrange or caption clips, add text, transitions or motion titles, run an auto edit, or undo; or when they want a saved editor project rendered to a video file without opening the editor. Covers editor_sessions, editor_commands, editor_run, render_project and render_status.
license: MIT
---

# Drive the FunAI video editor

The editor runs in the person's browser. `editor_run` sends one command into it, exactly as
if they had clicked it: it lands as one undo entry and the editor saves it. You are working
on their real project, so be deliberate.

## Rules that always apply

- Describe the project, clips and changes in plain words. Session ids and project ids are
  for the tool calls only.
- Before a change the person did not spell out (deleting clips, an auto edit, restyling every
  caption), say what you will do and wait for a yes.
- Commands marked **billed** in `editor_commands` (AI tasks, transcription, translation)
  spend credits. Tell the person the price and pass `confirm: true` only after they agree.
- Renders spend credits too. Price first.

## Find the editor and its commands

1. `editor_sessions` lists the editors open in the person's browser. If none is open, ask
   them to open their project in the FunAI editor (they need to be signed in there).
   If several are open, ask which project, and pass that `session_id` from then on.
2. `editor_commands` returns what that editor offers right now, grouped (clips, captions,
   transcript, transitions, AI tasks, motion titles, auto edit, history, playback), with
   parameters. Use `group` to narrow it. Always take command names and parameters from
   here; do not guess them. Times are in seconds.

## Make changes

```
editor_run({ "command": "clips.addText", "args": { "text": "Spring drop", "at": 0, "seconds": 3 } })
```

- Run one command at a time and read each result before the next.
- After a group of changes, summarise what changed. The person can undo any step in the
  editor, or you can use the history commands from `editor_commands`.
- `editor_run` is marked destructive because it edits their project: never run commands the
  person did not ask for.

## Render a saved project on the server

`render_project` renders a **saved** project to a video file with no browser open, through
FunAI's basic server render.

1. Call `render_project` with `project_id` and, if they want a size preset, `platform`
   (`project`, `reels`, `shorts`, `tiktok`, `story`, `youtube`, `square`) and `format`
   (`mp4` or `webm`), **without** `confirm`. It returns the price and what a basic render
   leaves out (effects, keyframes, text animations; text, captions and crossfades are kept).
2. Tell the person both, and ask.
3. Call again with `confirm: true` to start. It waits for the file link, or returns an
   `export_id` for long renders: follow it with `render_status` (`project_id` and `export_id`).

For effects the basic render drops, the person can export from the editor itself.
