---
name: funai-voice-and-music
description: Make speech, music, sound effects and lip-synced clips with the FunAI MCP server. Use when the person wants a voiceover, narration, text-to-speech, a song or background music, a sound effect, sound added to a video, a voice changed or cleaned up, a transcription, or a talking clip synced to audio, and the FunAI tools (generate_audio, generate_video, generate_text, list_models, estimate_cost) are available.
license: MIT
---

# Voice, music, sound effects and lip sync with FunAI

Speech, music and sound-effect models take very different prompts, so `generate_audio`
always needs a deliberate model choice. Find the right kind of model first.

## Rules that always apply

- Offer models by **name and price**; never ask for or show ids.
- Say the price before running anything long (a full narration, a long track) and wait for
  a yes. Speech is usually priced per 1,000 characters; music and effects per few seconds.
- Results are published with a shareable link by default; pass `private: true` when asked,
  and offer it when the person's own voice is involved.

## Find the right model

Call `generate_audio` without `model` to get `status: NEEDS_MODEL_CHOICE` with options, or
search the catalog:

| The person wants | `list_models` filter |
| --- | --- |
| A voiceover or narration | `model_type: "text_to_audio"`, `query: "tts"` or `"speech"` |
| A song or background music | `model_type: "text_to_audio"`, `query: "music"` |
| A sound effect | `model_type: "text_to_audio"`, `query: "sound effects"` |
| A voice changed, isolated or cloned | `model_type: "audio_to_audio"` |
| Sound for a silent video | `model_type: "video_to_audio"` |
| A transcript of audio or video | `model_type: "audio_to_text"` or `"video_to_text"` |
| A face lip-synced to audio | `task: "lip-sync"` (video models) |

Then read `get_model_schema` for the model: voice names, languages, speed, duration and the
exact field names. Model-specific options (a voice, a style, lyrics, a genre) go in `params`
by those field names.

## Speech

- The `prompt` is the exact text to speak. Do not add stage directions the model would read
  aloud; use the model's own options for tone or voice when it has them.
- For long scripts, price first with `estimate_cost` and `char_count` (the length of the text).

```
estimate_cost({ "model": "ElevenLabs TTS Turbo v2.5", "char_count": 1800 })
generate_audio({ "model": "ElevenLabs TTS Turbo v2.5", "prompt": "Welcome to the spring collection..." })
```

## Music and sound effects

- Music: describe genre, mood, tempo, instruments and length. Use `duration` where the
  model supports it. If the model takes lyrics, pass them in the field `get_model_schema` names.
- Sound effects: describe the sound concretely ("heavy wooden door creaking open in a stone
  hall") and keep clips short.

## Working with existing audio or video

- `audio_url` for audio in (voice change, cleanup, transcription), `video_url` to add sound to
  a video. Inputs are public https URLs or a `file_url` from `upload_file`.
- Transcription and captioning can also go through `generate_text` with `audio_url` or
  `video_url` and a transcription-capable model.

## Lip sync

Lip sync is a video job: use `generate_video` with `video_url` (or `image_url` for a still
face) and `audio_url`, on a model found with `list_models` `task: "lip-sync"`. Follow the
funai-make-videos skill for pricing, waiting and stopping. A common flow is: make the
voiceover with `generate_audio`, then pass its output link as `audio_url`.

## When it fails

`isError: true` results explain the problem (unsupported input, refused text, insufficient
credits). Fix and retry once, or offer another model. For money, follow funai-spend-wisely.
