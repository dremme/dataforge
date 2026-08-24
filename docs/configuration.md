# Configuration

How to configure DataForge after the [quick start](../README.md#quick-start).

## The `.env` file

On startup the backend loads the **first** file that exists:

1. Project root `.env` — next to `start.bat`
2. `backend/.env`

OS and shell environment variables always win over the file. `.env` is gitignored — copy
[`.env.example`](../.env.example) to get started, and restart the backend after editing.

## Server ports

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATAFORGE_UI_PORT` | `8081` | The port you open. Production binds it for the UI *and* the API; in development Vite binds it, and it drives the backend CORS allowlist |
| `DATAFORGE_API_PORT` | `8080` | **Development only** — port the API binds, and the Vite `/api` proxy target |
| `DATAFORGE_API_HOST` | `127.0.0.1` | Interface the server binds (`scripts/dev_server.py` and `scripts/prod_server.py`) |

Production serves both halves from one process, so `DATAFORGE_API_PORT` is never bound there and CORS
never applies.

All four readers — [`frontend/vite.config.ts`](../frontend/vite.config.ts), [`backend/server_settings.py`](../backend/server_settings.py),
[`scripts/dev_server.py`](../scripts/dev_server.py), and [`scripts/dev-common.ps1`](../scripts/dev-common.ps1) — resolve these
from the same project-root `.env`, and an OS environment variable overrides the file in each.
Restart the servers after a change; Vite reads its port once at startup.

## Vision LLM

DataForge talks to any **OpenAI-compatible** vision endpoint. Load a model in llama.cpp, Unsloth, or similar before
running AI jobs, and set `OPENAI_MODEL` to the **id your server exposes** — not necessarily the Hugging Face repo name.

**Suggested models, best first:**

| Model | Notes |
| --- | --- |
| [Qwen3.8 27B](https://huggingface.co/Qwen/Qwen3.8-27B) | Recommended dense default |
| [Qwen3.8 27B GGUF](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF) | Recommended dense quantizations; for example `UD-Q4_K_XL` |
| [Qwen3.8 27B Uncensored](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF) | Dense alternative with fewer refusals |
| [Qwen3.6 35B A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) | Recommended MoE default |
| [Qwen3.6 35B A3B Uncensored](https://huggingface.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive) | MoE alternative with fewer refusals |
| [Qwen3-Omni 30B A3B Instruct](https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct) | Omni MoE that also **hears audio** — the one to load for [audio captioning](#audio-captioning) |
| [Qwen3 VL 8B Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct) | Lighter VLM for smaller GPUs |

[Gemma 4 31B it](https://huggingface.co/google/gemma-4-31B-it) and [Gemma 4 26B A4B it](https://huggingface.co/google/gemma-4-26B-A4B-it)
also work with some tuning. Gemma-family models typically want `OPENAI_INSTRUCT_REPEAT_PENALTY` around `1.1`, where the
Qwen3.6 defaults leave it disabled. They have no thinking mode, so run them in instruct mode and leave `OPENAI_THINKING_*` alone.

**Connection settings** — defaults target a local server:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_BASE_URL` | `http://127.0.0.1:8888/v1` | OpenAI-compatible base URL |
| `OPENAI_API_KEY` | `EMPTY` | Not a credential. Local servers ignore it unless started with `--api-key` |
| `OPENAI_MODEL` | `qwen38` | Chat `model` id, matching what your server exposes |
| `OPENAI_MAX_TOKENS` | `16384` | Completion max tokens |
| `OPENAI_TIMEOUT` | `600` | Seconds to wait for a response before giving up |

Many single-model servers answer even with a wrong `OPENAI_MODEL`. Multi-model servers need the id to match.

`llama-server` defaults to port `8080`, which DataForge's API already uses. Start it on `8888` to match
`OPENAI_API_BASE_URL` above:

```bash
llama-server --port 8888 -m <model.gguf> --mmproj <mmproj.gguf>
```

`--mmproj` loads the multimodal projector, which llama.cpp keeps separate from the weights. Without it you get a
server that answers text but silently ignores images — which shows up here as captions describing nothing in
your media. No API key is needed unless you start the server with `--api-key`.

### Audio captioning

Video models that condition on sound need captions that say what a clip *sounds* like,
which keyframes alone cannot supply. Tick **Caption audio** in the auto-caption dialog and each MP4's audio track
is sent in the same request as its keyframes, with a line added to the system prompt asking the model to describe
what it hears.

This needs an **omni** model — one that accepts audio input, such as
[Qwen3-Omni 30B A3B Instruct](https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct) — served by a backend
built with audio support. A vision-only model ignores the audio and captions the frames as usual, so the option
is off by default. Set `OPENAI_MODEL` to the omni model's id as your server exposes it.

Details worth knowing:

- Only the **first 15 seconds** of a clip are sent — as much as current local omni models take
- Clips with no audio track are **still captioned** from their keyframes — the model typically calls them
  silent — and the job finishes with a warning naming how many there were
- Still images are unaffected, and so are GIFs: they are captioned as images
- Verify-captions never sends audio, so it works with a vision-only model as before

## Sampling knobs

Per-mode temperature, penalties, and top-p/k:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_THINKING_TEMPERATURE` | `1.0` | Sampling temperature in thinking mode |
| `OPENAI_THINKING_PRESENCE_PENALTY` | `0.0` | Presence penalty in thinking mode |
| `OPENAI_THINKING_TOP_P` | `0.95` | Top-p in thinking mode |
| `OPENAI_THINKING_MIN_P` | `0.0` | Min-p in thinking mode (via `extra_body`) |
| `OPENAI_THINKING_REPEAT_PENALTY` | `1.0` | Repetition penalty in thinking mode (via `extra_body`) |
| `OPENAI_INSTRUCT_TEMPERATURE` | `0.7` | Sampling temperature in instruct mode |
| `OPENAI_INSTRUCT_PRESENCE_PENALTY` | `1.5` | Presence penalty in instruct mode |
| `OPENAI_INSTRUCT_TOP_P` | `0.8` | Top-p in instruct mode |
| `OPENAI_INSTRUCT_MIN_P` | `0.0` | Min-p in instruct mode (via `extra_body`) |
| `OPENAI_INSTRUCT_REPEAT_PENALTY` | `1.0` | Repetition penalty in instruct mode (via `extra_body`) |
| `OPENAI_TOP_K` | `20` | Top-k (via `extra_body`) |

`repeat_penalty` follows llama.cpp naming. Hugging Face– and vLLM-style stacks call the same knob
`repetition_penalty`, which is the spelling you will see on model cards — rename it if you point
DataForge at one of those servers.

## Still image detail

| Variable | Default | Purpose |
| --- | --- | --- |
| `IMAGE_MAX_PIXELS` | `1500000` | Per-image pixel budget for a still |

A still is the only image in its request, so it affords detail a keyframe cannot — both caption jobs
send them at this one budget. Lower it the way you would lower the video budget below, if a still
ever runs into the same VRAM wall.

## Video keyframe sampling

A video is sent as still keyframes, sampled twice a second plus both endpoints, each labelled with its
timestamp. Short clips keep at least eight frames. Values that are not positive whole numbers are ignored.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VIDEO_KEYFRAMES_PER_SECOND` | `2` | How densely a clip is sampled |
| `VIDEO_MAX_KEYFRAMES` | `42` | Ceiling on frames per clip. Binds from 20 seconds (`2 × 20 + 2`) |
| `VIDEO_FRAME_MAX_PIXELS` | `500000` | Per-frame pixel budget through 7 seconds |
| `VIDEO_FRAME_MIN_PIXELS` | `262144` | Per-frame pixel budget from 20 seconds on, and the per-side resize floor |

**Count.** The cap is why brief actions go missing on long clips. At the default it binds from 20
seconds, so a two-minute clip still sends 42 frames (~0.35 fps) and a one-second action is likelier
to fall between frames than land on one. Raising `VIDEO_MAX_KEYFRAMES` is the fix, at roughly 640
vision tokens per frame — 84 frames is about 54k tokens before the prompt.

**Size.** Per-frame pixels stay at `VIDEO_FRAME_MAX_PIXELS` through 7 seconds, then lerp down to
`VIDEO_FRAME_MIN_PIXELS` at 20 seconds and stay there. That is what keeps a long clip inside context
and VRAM without thinning the short clips. Raise `VIDEO_FRAME_MAX_PIXELS` for detail on short clips;
lower `VIDEO_FRAME_MIN_PIXELS` to shrink long-clip frames further.

**The min also sets the per-side resize floor.** The default `262144` is 512×512, Qwen's 32-pixel
patch grid. Neither side is scaled below that floor unless you lower `VIDEO_FRAME_MIN_PIXELS`. With
the default, a 1920×1080 frame goes 928×512 at `500000`, 640×512 at `250000` (squashed to 1.25 from
1.78), and 512×512 at `125000`. Lowering `VIDEO_FRAME_MAX_PIXELS` alone does not buy more frames, and
below the min it changes shape instead of shrinking.

### Videos that come back with an empty caption

**Symptom.** A job logs `api_error` for clips that caption fine on their own, and the model server
reports nothing wrong. It answered `200` with `finish_reason=stop`, `completion_tokens=0`, and no
content — which the backend logs, along with the response's token counts.

**Cause.** Weights, KV cache, and the vision encoder's working buffer share one VRAM pool, and the
server sizes that buffer when the model loads. Leave it too little and large multi-frame requests get
their image payload silently truncated. The tell is a `prompt_tokens` well below what that same file
reports on a run that succeeds.

**Fixes** — free VRAM, or ask for less of it:

- A smaller quantization, or a shorter context
- Send less per request: lower `VIDEO_FRAME_MAX_PIXELS` (short clips) and/or `VIDEO_FRAME_MIN_PIXELS`
  (long clips). `VIDEO_FRAME_MAX_PIXELS=262144` with the default min is the previous advice, and
  still the first thing to try.

## Draft caption length

| Variable | Default | Purpose |
| --- | --- | --- |
| `DRAFT_CAPTION_THRESHOLD` | `256` | Characters. Both ends of what auto-caption counts as a caption |

One knob, two gates. A draft **longer** than this is already a finished caption, so auto-caption
leaves it alone and counts it `skipped_long`. A caption the model returns **at or under** it is not
an answer, so it is retried and, if it stays short, counted `too_short`. Raise it to demand more
detail; lower it to accept shorter captions and to stop re-visiting drafts you consider done.

Verify-captions ignores it — it checks captions rather than writing them. Edit-captions ignores it
too, though it does write them: an instruction like "shorten to one sentence" is meant to land under
this threshold, so gating on it would reject the edit for working.

## Reasoning effort

Not an environment setting: **Reasoning effort** and **Preserve thinking** are picked per job, in the
auto-caption, verify-captions and edit-captions dialogs.

The three levels are fixed by the chat template, which **raises** on anything else, so `high` is not a value:

| Level | Effect |
| --- | --- |
| `low` | Adds an instruction to keep thinking brief and move to the conclusion |
| `medium` | Adds no instruction at all — the model reasons as it normally would. **DataForge's default** |
| `xhigh` | Adds an instruction to validate assumptions and weigh alternatives. The *template's* own default |

DataForge defaults to `medium` where the template defaults to `xhigh`, so the value is sent on every
reasoning-mode request rather than omitted at the default the way `repeat_penalty` is. It goes out twice —
inside `chat_template_kwargs`, which Unsloth and vLLM feed to the Jinja render, and as a top-level
`reasoning_effort` field, which llama.cpp reads. A server that knows neither ignores both.

Only templates that read the key respond to it: the shipped
[`llm-templates/qwen38_template.jinja`](../llm-templates/qwen38_template.jinja) does, while the Qwen3.6 and
Gemma 4 templates ignore it and caption the same at every level.

**Preserve thinking** keeps earlier assistant reasoning in the rendered prompt. It is on by default, matching
every shipped template. It has no visible effect on captioning today, since each request is a single turn with
no prior reasoning to keep — it matters only once a flow sends the model its own earlier answers.

## Paths, integrations, and logging

| Variable | Purpose |
| --- | --- |
| `HF_TOKEN` or `HUGGING_FACE_HUB_TOKEN` | Auth for gated SAM weights |
| `OSTRIS_TOOLKIT_ROOT` | Path to an AI-Toolkit install, so external train jobs can be listed |
| `DATAFORGE_DB_PATH` | Override the SQLite path (default is under `backend/data/`) |
| `DATAFORGE_THUMBNAIL_CACHE` | Override the thumbnail cache directory |
| `DATAFORGE_THUMBNAIL_CACHE_MAX_MB` | Thumbnail cache size ceiling (default `2048`). Least recently used entries are dropped past it; `0` never deletes |
| `DATAFORGE_LOG_LEVEL` | Backend log level (default `INFO`) |
| `DATAFORGE_SERVE_UI` | Serve `frontend/dist` at `/`. Set automatically by `scripts/prod_server.py`; leave it unset for development |
