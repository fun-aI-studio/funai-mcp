---
name: funai-create-images
description: Create and edit images with the FunAI MCP server. Use when the person asks for a picture, poster, logo, product shot, thumbnail, illustration or photo edit (change a background, inpaint with a mask, restyle, combine reference images) and the FunAI tools (generate_image, list_models, get_model_schema, run_model, upload_file) are available. Covers choosing a model by name and price, writing prompts, editing with image_url, mask_url and image_urls, and showing the result.
license: MIT
---

# Create and edit images with FunAI

FunAI's MCP server gives you hundreds of image models. Your job is to turn what the person
wants into one good call, at a price they agreed to, and show them the picture.

## Rules that always apply

- If the person types a FunAI slash command (`/remove-background`, `/halloween`) or pastes a
  funai.art link, pass it to `resolve_command` first (see the funai-tools-and-templates skill).
- Talk about models by their **name and price** ("FLUX 2, about one cent an image").
  Never ask the person for an id, and never show them job ids, file ids or model slugs.
- Pass the model's name in `model`. The server resolves names. If a name matches several
  models, or the call needs a deliberate choice, the tool answers with
  `status: NEEDS_MODEL_CHOICE` and a short list of options. That is not an error and nothing
  was charged: show the options and ask which one.
- Every generation spends the person's FunAI credits. Image runs are usually cheap, but
  say the price before anything above a few cents, and before batches.
- Results are published with a shareable funai.art link by default. If the person wants an
  image kept private (for example a photo of themselves), pass `private: true`.

## Choosing a model

1. If the person named a model, use that name.
2. If they did not, a plain text-to-image request can go without `model`: FunAI uses its
   default image model. For anything with a particular need (readable text in the image,
   photorealism, a style, a cheap draft, high resolution), call
   `list_models` with `model_type: "text_to_image"` (or `"image_to_image"` for edits) and a
   `query`, then offer two or three models by name with their price per image.
3. Before using unusual options, call `get_model_schema` with the model name. It lists the
   exact inputs, the allowed `aspect_ratio` and `resolution` values, and the price.

## Writing the prompt

- Lead with the subject, then setting, composition, lighting, style and mood. Keep it to
  what should be visible.
- Put things to avoid in `negative_prompt` (only for models that accept it), not in the prompt.
- Use `aspect_ratio` (for example `16:9`, `9:16`, `1:1`) only with values the model lists in
  `get_model_schema`. Some models take `width`/`height` instead.
- Use `seed` when the person wants to iterate on the same picture.
- Model-specific settings (guidance, steps, style presets) go in `params`, by the field names
  from `get_model_schema`.

## Editing an existing image

- `image_url`: the image to edit or restyle.
- `mask_url`: for inpainting, a mask where white marks the area to change.
- `image_urls`: several reference images (a product plus a scene, faces for a group shot)
  for models that accept more than one.
- Media inputs must be **public https URLs** or a `file_url` from `upload_file`. When the
  person gives you a local file, see the funai-tools-and-templates skill for `upload_file`.
- With a media input and no model, the tool offers models that accept it. Let the person pick.

## Running it

```
generate_image({
  "prompt": "A lone starship falling toward a black hole, lit only by the accretion disc, cinematic, ultra detailed",
  "model": "FLUX 2",
  "aspect_ratio": "1:1"
})
```

- Fast models return the image in the same call. The image is attached to the result:
  show it, do not just paste the link. The link is for opening it in FunAI.
- Slower models return a `job_id`. Follow it with `get_job_status` until it completes.
- For options `generate_image` does not expose, use `run_model` with `inputs` exactly as
  `get_model_schema` lists them.

## When it fails

- A tool result with `isError: true` explains why (an input the model does not accept, a
  prompt refused by moderation, insufficient credits). Fix the input and try again once, or
  tell the person. Do not loop on the same failing call.
- For insufficient credits or a reached spending limit, follow the funai-spend-wisely skill.
