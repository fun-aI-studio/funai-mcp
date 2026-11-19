---
name: funai-make-videos
description: Make videos with the FunAI MCP server. Use when the person wants a video clip, an animated photo, a product video, a video between a start and an end frame, a restyled video or a lip-synced clip, and the FunAI tools (generate_video, list_models, estimate_cost, get_job_status, cancel_job) are available. Covers text-to-video versus image-to-video, start and end frames, length and price, waiting for long jobs, and the rules for stopping a job.
license: MIT
---

# Make videos with FunAI

Video is the most expensive thing FunAI makes, and it takes minutes. Agree on the model and
the price with the person first, start one job, and follow it to the end.

## Rules that always apply

- Talk about models by **name and price**. Never ask for or show ids (model slugs, job ids,
  file ids).
- **Always tell the person the price before you start a video** and wait for a yes. A
  10-second clip on a premium model can cost several dollars.
- Start a paid call once. Never retry a `generate_video` call that timed out or whose
  answer you did not see: the job was very likely created and billed. Check
  `list_generations` or `get_job_status` first.
- Results are published with a shareable link by default; pass `private: true` when the
  person asks for privacy.

## Pick the kind of video

| The person has | Use | Inputs |
| --- | --- | --- |
| Only an idea | text-to-video | `prompt` |
| A photo to animate | image-to-video | `image_url` (or `start_frame_url`) and a `prompt` describing the motion |
| A first and a last frame | first/last frame | `start_frame_url` and `end_frame_url`, on a model that supports both |
| A video to restyle | video-to-video | `video_url` and a `prompt` |
| A face video plus a voice track | lip sync | `video_url` (or `image_url`) and `audio_url` |

Media inputs must be public https URLs or a `file_url` from `upload_file`.

## Pick the model and price it

1. Call `generate_video` **without** `model`, or call `list_models` with
   `model_type: "text_to_video"` or `"image_to_video"` (and a `query` or `task`, such as
   `lip-sync`). Without a model, `generate_video` answers `status: NEEDS_MODEL_CHOICE` with a
   few suitable models and prices. Nothing is charged.
2. Offer two or three by name, with the price for the length the person wants. Many video
   models bill per second, so price with `estimate_cost` and the `duration`:

```
estimate_cost({ "model": "Kling Video v3 Standard", "workflow": "text_to_video", "duration": 10 })
```

3. Check the model's options with `get_model_schema`: allowed `duration`, `aspect_ratio`,
   `resolution`, and whether it takes an end frame or audio. Use only listed values.

## Write the prompt

Describe the shot as a director would: subject, action, camera movement (slow orbit, push
in, handheld), setting, lighting and style. For image-to-video, describe the **motion**, not
the picture, since the model already sees it. Keep one main action per clip.

## Start and follow the job

```
generate_video({
  "prompt": "Slow orbit around the sneaker on a wet street at night, neon reflections",
  "model": "Kling Video v3 Standard",
  "image_url": "https://example.com/sneaker.jpg",
  "duration": 5,
  "aspect_ratio": "9:16"
})
```

- Clients that accept streaming keep the call open and receive progress while the video
  renders. After about three minutes, or on clients without streaming, the call returns a
  `job_id` instead.
- Follow a `job_id` with `get_job_status`. Videos usually take a few minutes: check about
  every 20 to 30 seconds rather than in a tight loop, and tell the person it is still
  rendering. Progress numbers can sit at 0 until the end, which is normal.
- When it completes, give the person the video link from the result.

## Stopping a job

`cancel_job` is free **only while the job is still queued**. Once the provider has started,
stopping costs the full price and the video still arrives. In that case the tool does not
stop it: it reports the price. Tell the person and ask. Call again with
`accept_charge: true` only if they agree. Never set `accept_charge` on your own.

## When it fails

A tool result with `isError: true` says why (input the model does not accept, refused prompt,
insufficient credits, a model that is temporarily unavailable). Correct the input, or offer
another model by name. For credits and spending limits, follow the funai-spend-wisely skill.
