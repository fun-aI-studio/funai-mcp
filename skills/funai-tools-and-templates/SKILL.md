---
name: funai-tools-and-templates
description: Use FunAI's one-shot Tools and ready-made templates, bring local files into FunAI, and reach any model's full inputs. Use when the person types a FunAI slash command or pastes a funai.art link (/remove-background, /edit-video, /halloween, /halloween/<preset>), wants a packaged result such as face swap, upscale, background removal, product shots, virtual try-on or a trend template, gives you a file on their computer to use as input, or needs model options the generate tools do not expose. Covers resolve_command/list_categories, list_tools/run_tool, list_templates/apply_template, upload_file, get_model_schema/run_model and list_generations.
license: MIT
---

# FunAI Tools, templates, uploads and any model

## Rules that always apply

- Name Tools, templates and models to the person by their **name and price**. Slugs and ids
  (`tool_slug`, `template_id`, `file_url`, job ids) are for the tool calls only.
- Everything that generates spends credits. Say the price before running, and ask before
  anything above a few cents or any batch.
- Results are published with a shareable link by default; pass `private: true` when asked.

## Slash commands and funai.art links

People can type a command such as `/remove-background`, `/edit-video`, `/upscale`,
`/halloween` or `/halloween/blood-moon-howl-transformation`, or paste a funai.art preset,
Tool or model link. Commands come from FunAI's live catalogue: every task, Tool, preset
collection and preset has one.

1. Pass exactly what they typed (or the link) to `resolve_command`. It is free and runs
   nothing. It answers with what the command is (a task, Tool, preset collection, preset or
   model), its price, the inputs it needs and a `next_step` naming the tool to call.
2. Tell the person what it does and what it costs, ask for any missing input (usually a
   photo or a video), and run it with the tool `next_step` names (`run_tool`,
   `apply_template`, `generate_*` or `run_model`) only after they agree.
3. If the answer offers options (a task that works on images and on video, a typo that
   could mean two things, a model name that matches several), show them by name and ask.
   A typo read with confidence comes back with a note such as "Read '/haloween' as
   /halloween": mention it in passing.
4. Where a Tool and a task share a name, `/tools/<slug>` opens the Tool and
   `/presets/<collection>` opens a preset collection.
5. "Which commands are there?" is `list_categories` (preset collections, Tools or tasks).

In Claude Code the tasks and preset collections are also MCP prompts, such as
`/mcp__funai__remove-background` and `/mcp__funai__halloween`; they start the same flow.

## Tools: one-shot outcomes

A FunAI Tool is a finished workflow with a model already chosen: face swap, upscale,
background removal, product shots, lip sync and more.

1. `list_tools` with a `query` ("face swap", "upscale", "product") to find candidates. It is
   paged: pass `next_cursor` back as `cursor` for more.
2. Tell the person what the Tool does and what it costs. To price it, call `estimate_cost`
   with the Tool's model.
3. Run it: `run_tool` with `tool_slug` from `list_tools`, the media inputs in `inputs` (or a
   `prompt` for Tools that take one), and optionally `model` by name for another of the
   Tool's models. Field names come from `get_model_schema` for the Tool's model.
4. A slow result returns a `job_id`: follow it with `get_job_status`.

## Templates: a look with the prompt already written

1. `list_templates` with a `query` ("product shot", "anime"), a `media_type`, a
   `category` (a preset collection such as `halloween`), or a `tool_slug`. Each template
   lists the slots to fill (a photo, a product name, a style).
2. Ask the person for anything required that you do not have.
3. `apply_template` with `template_id` (or the preset's `/collection/preset` command) and
   `slot_values` keyed by slot key. Image slots take a public https URL or a `file_url`
   from `upload_file`. Leave out `model` to use the template's best compatible model. `output_count` makes several variations, and multiplies
   the price, so confirm it.
4. A missing required slot fails without charging and lists the slots.

## Bringing in a local file

Media inputs must be public https URLs. A link the person already has (a public image URL)
needs no upload. For a file on their computer:

1. Call `upload_file` with `filename`, `mime_type` (for example `image/jpeg`, `video/mp4`,
   `audio/mpeg`, `model/gltf-binary`) and `size_bytes`. It returns a single-use `upload_url`.
2. PUT the bytes there. In a client with a shell:
   `curl -X PUT --data-binary @face.jpg -H 'Content-Type: image/jpeg' '<upload_url>'`.
   The PUT answers with the `file_url`.
3. Very small files (under about 700 KB) can go inline as `content_base64` instead of a PUT.
4. Pass the `file_url` as `image_url`, `video_url`, `audio_url` or a template slot. Uploaded
   files stay private to the account. Uploading is free but counts toward storage.

Only upload files the person asked you to use.

## Any model with its full inputs

`generate_*` covers common options. For everything else:

1. `get_model_schema` with the model's name (and a `workflow` such as `image_to_video`). It
   returns the inputs as JSON Schema, the price and a ready `run_model` example.
2. `run_model` with `model`, `workflow` and `inputs` keyed exactly as the schema lists them.
   Inputs are validated before anything is charged.

## Finding past results

`list_generations` lists the account's results, newest first, with status, prompt and link.
Filter with `media_type` or `tool_slug`. Use it before re-running anything whose result you
lost, so the person is not charged twice.
