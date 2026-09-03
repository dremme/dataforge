# Configuration

[DataForge documentation](README.md)

Use these recipes to get a working configuration, then use the grouped settings and complete
reference when you need to tune it. Settings in `.env` affect the app as a whole; controls in a job
dialog affect only that kind of job.

- [Start with a recipe](#start-with-a-recipe)
- [Understand loading](#how-configuration-is-loaded)
- [Configure the vision LLM](#vision-llm-connection)
- [Tune media inputs](#media-input-budgets)
- [Review every environment variable](#complete-environment-variable-reference)
- [Troubleshoot configuration](#troubleshooting)

## Start with a recipe

### Use DataForge without AI

Browsing, filtering, editing media, writing captions manually, and non-AI jobs do not need a model
or an API key. If the default ports work, do not create a `.env` file. To change only the port you
open, copy [`.env.example`](../.env.example) to `.env` in the project root and add:

```dotenv
DATAFORGE_UI_PORT=18081
```

Restart DataForge after adding or changing an environment variable. See
[Server and app settings](#server-and-app-settings) for development and bind-address settings.

### Connect a local vision model

Start an OpenAI-compatible server with a vision model loaded, then put this minimal configuration in
the project-root `.env`:

```dotenv
OPENAI_API_BASE_URL=http://127.0.0.1:8888/v1
OPENAI_API_KEY=EMPTY
OPENAI_MODEL=qwen38
```

Replace `qwen38` with the model id reported by your endpoint. Restart DataForge, create or edit the
dataset's `.sysprompt`, and run **Auto-caption**. `EMPTY` only satisfies the OpenAI SDK; it is not a
credential. If your server requires a key, replace it with the real one and keep `.env` out of source
control.

See [Vision LLM connection](#vision-llm-connection) for tested models and server setup, then
[Per-job AI controls](#per-job-ai-controls) for the choices made in each job dialog.

### Caption video audio

Use an omni model served by a backend that accepts OpenAI `input_audio` parts. A minimal local
configuration looks like this:

```dotenv
OPENAI_API_BASE_URL=http://127.0.0.1:8888/v1
OPENAI_API_KEY=EMPTY
OPENAI_MODEL=model-id-from-your-server
```

Restart DataForge if you changed `.env`. In **Auto-caption**, turn on **Caption audio**; that dialog
choice takes effect immediately and is not an environment variable. Audio captioning also requires
ffmpeg. See [Audio input](#audio-input) for the 15-second limit and silent-clip behavior.

### Connect ComfyUI

Start ComfyUI, then set its origin in `.env`:

```dotenv
COMFY_BASE_URL=http://127.0.0.1:9000
```

Restart DataForge. The **Process with ComfyUI** dialog should then report the endpoint as available.
Workflow presets use the repository's `comfy-workflows/` directory unless you set
`COMFY_WORKFLOWS_DIR`. Follow [Process images with ComfyUI](comfyui.md) for setup, preset authoring,
and candidate review.

### Connect AI-Toolkit

Install and start AI-Toolkit separately. DataForge always contacts its API at
`http://127.0.0.1:8675`; that endpoint is not configurable. Set the toolkit root when DataForge needs
help resolving AI-Toolkit state such as a relative SQLite path:

```dotenv
OSTRIS_TOOLKIT_ROOT=C:\AI-Toolkit
```

Restart DataForge after changing `.env`. The root does not start AI-Toolkit and does not change its
API address. Follow [Train LoRAs with AI-Toolkit](ai-toolkit.md) for installation and run details.

## How configuration is loaded

On backend startup, DataForge uses this precedence, highest first:

1. Variables already present in the OS or launching shell.
2. The project-root `.env`, next to the launchers, if it exists.
3. `backend/.env`, but only when the project-root `.env` does not exist.
4. Built-in defaults.

Only the first existing `.env` file is loaded. The two files are not merged, and file values do not
overwrite variables that already exist in the process environment. `.env` is gitignored; copy
[`.env.example`](../.env.example) to the project root rather than committing secrets or
machine-specific paths.

Restart DataForge after editing `.env` or the launching environment. This is required for launcher,
server, and Vite settings, and it avoids a running job using a mixture of old and new values.
Launcher-only interpreter and reload overrides belong in the
[getting-started](getting-started.md#launcher-options) and
[development](development.md) guides, not in the normal app configuration.

## Server and app settings

Production serves the UI and API from one process on `DATAFORGE_UI_PORT`. In development, Vite uses
that port for the UI and proxies `/api` to `DATAFORGE_API_PORT`. CORS is only needed in development;
its allowed loopback origins follow the UI port.

| Variable             | Default         | Used by                                   | When to change it                                                                                 |
| -------------------- | --------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `DATAFORGE_UI_PORT`  | `18081`         | Production server, Vite, backend CORS     | Another process holds the UI port or you want a different browser URL                             |
| `DATAFORGE_API_PORT` | `18080`         | Development API and Vite `/api` proxy     | Another process holds the development API port; it is not bound in production                     |
| `DATAFORGE_API_HOST` | `127.0.0.1`     | Development and production server scripts | You intentionally need to bind another interface; consider the network exposure first             |
| `DATAFORGE_SERVE_UI` | unset (`false`) | Backend static-file serving               | Normally never; the production server sets it automatically and development should leave it unset |

Changing the host does not change the development proxy destination: Vite still dials loopback. In
production, `DATAFORGE_API_PORT` is unused because the UI and API share `DATAFORGE_UI_PORT`.

## Vision LLM connection

DataForge uses an OpenAI-compatible chat-completions endpoint for **Auto-caption**, **Verify
captions**, and **Edit captions**. The defaults target a local server.

| Variable              | Default                    | Used by                        | When to change it                                                                        |
| --------------------- | -------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `OPENAI_API_BASE_URL` | `http://127.0.0.1:8888/v1` | All three vision-LLM jobs      | The endpoint runs at another origin or under another `/v1` path                          |
| `OPENAI_API_KEY`      | `EMPTY`                    | OpenAI SDK client              | The endpoint enforces authentication; local servers usually do not                       |
| `OPENAI_MODEL`        | `qwen38`                   | Chat-completions `model` field | Always when the endpoint exposes a different model id                                    |
| `OPENAI_MAX_TOKENS`   | `16384`                    | All three vision-LLM jobs      | The model/server context requires a smaller completion cap, or outputs are being cut off |
| `OPENAI_TIMEOUT`      | `600` seconds              | All three vision-LLM jobs      | Requests legitimately need longer, or you want failed endpoints detected sooner          |

`OPENAI_MODEL` is the id exposed by the running server, not necessarily a Hugging Face repository
name. Some single-model servers tolerate any id; multi-model servers generally require an exact
match.

The following models are tested guidance, not requirements:

| Model                                                                                                         | Guidance                                              |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [Qwen3.8 27B](https://huggingface.co/Qwen/Qwen3.8-27B)                                                        | Recommended dense starting point                      |
| [Qwen3.8 27B GGUF](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF)                                           | Recommended dense quantizations, such as `UD-Q4_K_XL` |
| [Qwen3.8 27B Uncensored](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF) | Dense alternative with fewer refusals                 |
| [Qwen3.6 35B A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B)                                                | Recommended MoE starting point                        |
| [Qwen3.6 35B A3B Uncensored](https://huggingface.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive)  | MoE alternative with fewer refusals                   |
| [Qwen3-Omni 30B A3B Instruct](https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct)                        | Omni MoE for video keyframes plus audio               |
| [Qwen3 VL 8B Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct)                                      | Lighter vision model for smaller GPUs                 |

[Gemma 4 31B it](https://huggingface.co/google/gemma-4-31B-it) and
[Gemma 4 26B A4B it](https://huggingface.co/google/gemma-4-26B-A4B-it) can also work with tuning.
Gemma-family models typically benefit from `OPENAI_INSTRUCT_REPEAT_PENALTY=1.1`. They have no
thinking mode, so select **Instruct** and leave the `OPENAI_THINKING_*` profile unused.

`llama-server` defaults to port `8080`. To match DataForge's default URL, start it on `8888` and load
the model's multimodal projector:

```bash
llama-server --port 8888 -m <model.gguf> --mmproj <mmproj.gguf>
```

llama.cpp stores multimodal projector weights separately from the model weights. Without `--mmproj`,
the server can answer text while silently ignoring images, producing captions unrelated to the
media. Add `--api-key` to the server only if you also set the same real key in `OPENAI_API_KEY`.

## Per-job AI controls

These are UI choices, not environment variables. DataForge remembers most dialog settings per job
and folder, with the most recently used settings as the fallback for a folder that has no saved
choice yet.

| Control                | Jobs and default                                                                 | Effect                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode**               | **Auto-caption**: Reasoning; **Verify captions** and **Edit captions**: Instruct | Reasoning is slower and can improve results; Instruct disables model thinking and uses the instruct sampling profile                            |
| **Reasoning effort**   | All three jobs: `medium`                                                         | In Reasoning mode, choose `low`, `medium`, or `xhigh`; it is disabled in Instruct mode                                                          |
| **Preserve thinking**  | All three jobs: on                                                               | Keeps earlier assistant reasoning in a rendered multi-turn prompt; caption jobs are currently single-turn, so it normally has no visible effect |
| **Caption audio**      | **Auto-caption**: off                                                            | Adds a video's extracted audio to its keyframes; requires an omni model and ffmpeg                                                              |
| **Additional context** | **Verify captions**: empty                                                       | Adds dataset-specific facts to the verification system prompt                                                                                   |
| **Edit instruction**   | **Edit captions**: empty and required                                            | Tells the model how to rewrite caption text; no media is sent                                                                                   |

Reasoning effort has three fixed values because the shipped Qwen3.8 chat template rejects other
values:

- `low` asks for brief thinking and a direct conclusion.
- `medium` adds no extra reasoning instruction and is DataForge's default.
- `xhigh` asks the model to validate assumptions and weigh alternatives; it is the template's own
  default.

DataForge sends the chosen effort both as top-level `reasoning_effort` for llama.cpp and in
`chat_template_kwargs` for Unsloth/vLLM-style servers. A server or template that does not recognize
it ignores it. The shipped `llm-templates/qwen38_template.jinja` reads it; the Qwen3.6 and Gemma 4
templates do not.

**Back up captions first** in **Edit captions** is on for every new run and is deliberately not
remembered, so an earlier unsafe choice cannot become invisible. Likewise, overwrite confirmations
in other jobs are not persistent settings.

## Media input budgets

These limits control what reaches the OpenAI-compatible endpoint; they do not resize source files.
Use the defaults first. If requests exhaust context or VRAM, reduce input before changing sampling.
If captions miss details, increase only the budget that constrains those files.

### Still images

| Variable           | Default   | Used by                                                                              | When to change it                                                                                       |
| ------------------ | --------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `IMAGE_MAX_PIXELS` | `1500000` | Still images and the first frame of GIFs in **Auto-caption** and **Verify captions** | Lower it for still-image VRAM failures; raise it when small details are lost and the model has capacity |

A still is the only image in its request, so it gets a larger budget than one video keyframe. Images
are downscaled for the request and encoded as JPEG; originals remain unchanged.

### Video keyframes

Start with the adjustment that matches the symptom:

- For empty captions or VRAM pressure on short clips, try `VIDEO_FRAME_MAX_PIXELS=262144` while
  leaving the minimum at its default.
- For pressure on long clips, lower `VIDEO_FRAME_MIN_PIXELS`; lowering only the maximum cannot shrink
  frames below the minimum's per-side floor.
- If a brief action disappears in a long clip, raise `VIDEO_MAX_KEYFRAMES`. Raise
  `VIDEO_KEYFRAMES_PER_SECOND` only when the cap does not already bind.
- If short clips lose visual detail, raise `VIDEO_FRAME_MAX_PIXELS` rather than adding frames.

| Variable                     | Default  | Used by                                                   | When to change it                                                    |
| ---------------------------- | -------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `VIDEO_KEYFRAMES_PER_SECOND` | `2`      | **Auto-caption** and **Verify captions**                  | Sample short and uncapped videos more or less densely                |
| `VIDEO_MAX_KEYFRAMES`        | `42`     | **Auto-caption** and **Verify captions**                  | Preserve more events in long clips, or reduce context and VRAM use   |
| `VIDEO_FRAME_MAX_PIXELS`     | `500000` | Each keyframe through 7 seconds                           | Trade short-clip image detail for request size                       |
| `VIDEO_FRAME_MIN_PIXELS`     | `262144` | Each keyframe from 20 seconds onward and the resize floor | Shrink long-clip frames further or change the minimum per-side floor |

DataForge samples evenly across the clip and includes both endpoints. The requested frame count is
`VIDEO_KEYFRAMES_PER_SECOND × ceil(duration in seconds) + 2`, with at least 8 and no more than
`VIDEO_MAX_KEYFRAMES`. At the defaults, the cap binds from 20 seconds, so a two-minute video still
sends 42 frames, about 0.35 frames per second. Values for these four settings that are not positive
whole numbers fall back to their defaults.

Each frame costs roughly 640 vision tokens with the tested Qwen setup: 42 frames are about 27,000
tokens and 84 are about 54,000 before the prompt. Actual tokenization depends on the model and
server.

The per-frame pixel budget remains at `VIDEO_FRAME_MAX_PIXELS` through 7 seconds, decreases linearly
to `VIDEO_FRAME_MIN_PIXELS` at 20 seconds, and stays there for longer clips. The minimum also derives
the per-side resize floor on Qwen's 32-pixel patch grid. The default `262144` gives a 512×512 floor.
With that floor, a 1920×1080 frame becomes approximately 928×512 at a `500000` budget, 640×512 at a
`250000` budget, and 512×512 at a `125000` budget. Below the floor, reducing the maximum changes the
shape instead of making both sides smaller.

### Audio input

Audio has no environment-variable budget. When **Caption audio** is enabled, DataForge extracts the
first 15 seconds of the first audio stream as 16 kHz mono WAV and sends it in the same request as the
video keyframes.

- A model and serving backend must support OpenAI `input_audio` content parts. Vision-only models may
  ignore the audio and caption the frames normally.
- A video with no usable audio track is still captioned from its keyframes. The completed job warns
  how many clips had missing audio.
- ffmpeg must be available before an audio-caption job can start.
- Still images and GIFs remain image requests.
- **Verify captions** never sends audio.

## Caption completion threshold

| Variable                  | Default          | Used by               | When to change it                                                                                                      |
| ------------------------- | ---------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DRAFT_CAPTION_THRESHOLD` | `256` characters | **Auto-caption** only | Raise it to demand longer generated captions; lower it to accept shorter captions and treat shorter drafts as finished |

One value controls two gates. A draft longer than the threshold is treated as already complete and
counted as `skipped_long`. A generated caption at or below the threshold is retried and, if it remains
short, counted as `too_short`. Values that are not positive whole numbers fall back to `256`.

**Verify captions** only checks existing captions. **Edit captions** intentionally accepts concise
edits, so neither job uses this threshold.

## Advanced sampling

Tune sampling only after the connection and media budgets are stable. Reasoning and Instruct modes
have separate profiles; `OPENAI_TOP_K` is shared.

| Variable                           | Default | Used by        | When to change it                                                         |
| ---------------------------------- | ------- | -------------- | ------------------------------------------------------------------------- |
| `OPENAI_THINKING_TEMPERATURE`      | `1.0`   | Reasoning mode | Adjust randomness for models that expose temperature                      |
| `OPENAI_THINKING_PRESENCE_PENALTY` | `0.0`   | Reasoning mode | Discourage reuse of previously emitted concepts                           |
| `OPENAI_THINKING_REPEAT_PENALTY`   | `1.0`   | Reasoning mode | Reduce repetition; `1.0` disables the field and omits it from the request |
| `OPENAI_THINKING_TOP_P`            | `0.95`  | Reasoning mode | Restrict nucleus sampling                                                 |
| `OPENAI_THINKING_MIN_P`            | `0.0`   | Reasoning mode | Enable server-specific min-p filtering through `extra_body`               |
| `OPENAI_INSTRUCT_TEMPERATURE`      | `0.7`   | Instruct mode  | Adjust randomness for direct answers                                      |
| `OPENAI_INSTRUCT_PRESENCE_PENALTY` | `1.5`   | Instruct mode  | Change the stronger default discouragement of reused concepts             |
| `OPENAI_INSTRUCT_REPEAT_PENALTY`   | `1.0`   | Instruct mode  | Reduce repetition; `1.0` disables the field and omits it from the request |
| `OPENAI_INSTRUCT_TOP_P`            | `0.8`   | Instruct mode  | Restrict nucleus sampling                                                 |
| `OPENAI_INSTRUCT_MIN_P`            | `0.0`   | Instruct mode  | Enable server-specific min-p filtering through `extra_body`               |
| `OPENAI_TOP_K`                     | `20`    | Both modes     | Change the shared top-k candidate limit through `extra_body`              |

DataForge sends the llama.cpp spelling `repeat_penalty`. Hugging Face- and vLLM-style stacks may
expect `repetition_penalty` instead. DataForge does not rename the field automatically; adapt the
server or compatibility layer if it rejects or ignores `repeat_penalty`.

## Integrations

| Variable              | Default                       | Used by                                                            | When to change it                                                                                                       |
| --------------------- | ----------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `COMFY_BASE_URL`      | `http://127.0.0.1:9000`       | **Process with ComfyUI** and availability checks                   | ComfyUI listens at another origin                                                                                       |
| `COMFY_WORKFLOWS_DIR` | repository `comfy-workflows/` | Preset listing and execution                                       | Store API-format workflow presets elsewhere                                                                             |
| `COMFY_IMAGE_TIMEOUT` | `900` seconds                 | Waiting for one processed image                                    | A workflow regularly needs more time, or a dead workflow should fail sooner; values below 30 seconds fall back to `900` |
| `OSTRIS_TOOLKIT_ROOT` | unset                         | Resolving AI-Toolkit state paths, including a relative SQLite path | DataForge cannot locate state from the training folder returned by AI-Toolkit                                           |

`COMFY_BASE_URL` accepts an origin with or without a trailing slash. Uploaded sources accumulate in
ComfyUI's `input/dataforge/` directory because ComfyUI has no endpoint to clear them; remove old
uploads there periodically. See the [ComfyUI guide](comfyui.md) for workflow and review behavior.

AI-Toolkit's API remains fixed at `http://127.0.0.1:8675`. `OSTRIS_TOOLKIT_ROOT` helps resolve files;
it does not redirect that API. See the [AI-Toolkit guide](ai-toolkit.md) for supported templates and
training controls.

## Data sent to integrations

DataForge is local-first, but the location of a configured endpoint defines the privacy boundary. If
an OpenAI-compatible or ComfyUI URL points to another machine, the payload in this table leaves the
local machine. Review the endpoint operator's storage and logging policy before using a remote URL.

| Action                   | Payload                                                                                                                                                            | Destination                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **Auto-caption**         | A resized still or resized video keyframes; draft caption and `.sysprompt`-derived instructions; optionally the first 15 seconds of audio                          | `OPENAI_API_BASE_URL`                                 |
| **Verify captions**      | A resized still or resized video keyframes, the existing caption, verification instructions, and optional **Additional context**; never audio                      | `OPENAI_API_BASE_URL`                                 |
| **Edit captions**        | Existing caption text, the edit instruction, and prompt instructions; no media                                                                                     | `OPENAI_API_BASE_URL`                                 |
| **Process with ComfyUI** | Source image bytes plus the selected workflow inputs                                                                                                               | `COMFY_BASE_URL`                                      |
| **Quick LoRA training**  | Dataset filesystem paths and the generated training configuration, including prompts and template settings; DataForge does not upload media bytes through this API | Fixed local AI-Toolkit API at `http://127.0.0.1:8675` |

AI-Toolkit must be able to read the dataset paths it receives. Its API is fixed to loopback, but the
training configuration controls what AI-Toolkit itself reads and where it writes outputs.

## Storage and logging

| Variable                           | Default                    | Used by                           | When to change it                                             |
| ---------------------------------- | -------------------------- | --------------------------------- | ------------------------------------------------------------- |
| `DATAFORGE_DB_PATH`                | `backend/data/app.db`      | SQLite preferences and job state  | Put app state on another disk or in a managed location        |
| `DATAFORGE_THUMBNAIL_CACHE`        | `backend/data/thumbnails/` | Generated WebP thumbnails         | Put cache data on a faster or larger disk                     |
| `DATAFORGE_THUMBNAIL_CACHE_MAX_MB` | `2048`                     | Least-recently-used cache pruning | Set a different ceiling; `0` or less disables pruning         |
| `DATAFORGE_LOG_LEVEL`              | `INFO`                     | Backend console logging           | Use `DEBUG` for diagnosis or a quieter standard logging level |

Parent directories for the database and thumbnail cache are created as needed. Invalid thumbnail
cache sizes fall back to `2048`; negative values are treated as `0`. Unknown log-level names fall
back to `INFO`.

## Complete environment variable reference

This is the exhaustive user-facing `.env` reference. The grouped sections above explain interactions
and tuning consequences.

| Variable                           | Default                       | Used by                                | When to change it                       |
| ---------------------------------- | ----------------------------- | -------------------------------------- | --------------------------------------- |
| `DATAFORGE_UI_PORT`                | `18081`                       | Production UI/API; development UI/CORS | Change the browser-facing port          |
| `DATAFORGE_API_PORT`               | `18080`                       | Development API/proxy                  | Change the development-only API port    |
| `DATAFORGE_API_HOST`               | `127.0.0.1`                   | Server launchers                       | Bind another interface intentionally    |
| `DATAFORGE_SERVE_UI`               | unset (`false`)               | Backend static UI                      | Leave unset; production sets it         |
| `OPENAI_API_BASE_URL`              | `http://127.0.0.1:8888/v1`    | Vision-LLM jobs                        | Point to another compatible endpoint    |
| `OPENAI_API_KEY`                   | `EMPTY`                       | OpenAI client                          | Supply endpoint authentication          |
| `OPENAI_MODEL`                     | `qwen38`                      | Vision-LLM jobs                        | Match the endpoint's exposed model id   |
| `OPENAI_MAX_TOKENS`                | `16384`                       | Vision-LLM jobs                        | Change the completion cap               |
| `OPENAI_TIMEOUT`                   | `600` seconds                 | Vision-LLM jobs                        | Change request timeout                  |
| `OPENAI_THINKING_TEMPERATURE`      | `1.0`                         | Reasoning profile                      | Tune reasoning sampling                 |
| `OPENAI_THINKING_PRESENCE_PENALTY` | `0.0`                         | Reasoning profile                      | Tune concept reuse                      |
| `OPENAI_THINKING_REPEAT_PENALTY`   | `1.0`                         | Reasoning profile                      | Tune repetition                         |
| `OPENAI_THINKING_TOP_P`            | `0.95`                        | Reasoning profile                      | Tune nucleus sampling                   |
| `OPENAI_THINKING_MIN_P`            | `0.0`                         | Reasoning profile                      | Tune min-p filtering                    |
| `OPENAI_INSTRUCT_TEMPERATURE`      | `0.7`                         | Instruct profile                       | Tune direct-answer sampling             |
| `OPENAI_INSTRUCT_PRESENCE_PENALTY` | `1.5`                         | Instruct profile                       | Tune concept reuse                      |
| `OPENAI_INSTRUCT_REPEAT_PENALTY`   | `1.0`                         | Instruct profile                       | Tune repetition                         |
| `OPENAI_INSTRUCT_TOP_P`            | `0.8`                         | Instruct profile                       | Tune nucleus sampling                   |
| `OPENAI_INSTRUCT_MIN_P`            | `0.0`                         | Instruct profile                       | Tune min-p filtering                    |
| `OPENAI_TOP_K`                     | `20`                          | Both sampling profiles                 | Tune shared top-k filtering             |
| `DRAFT_CAPTION_THRESHOLD`          | `256` characters              | **Auto-caption**                       | Change draft/generated completion gates |
| `IMAGE_MAX_PIXELS`                 | `1500000`                     | Still-image LLM requests               | Trade still detail for request size     |
| `VIDEO_KEYFRAMES_PER_SECOND`       | `2`                           | Video LLM requests                     | Change uncapped sampling density        |
| `VIDEO_MAX_KEYFRAMES`              | `42`                          | Video LLM requests                     | Change the per-video frame cap          |
| `VIDEO_FRAME_MAX_PIXELS`           | `500000`                      | Short-video keyframes                  | Change short-clip detail                |
| `VIDEO_FRAME_MIN_PIXELS`           | `262144`                      | Long-video keyframes and resize floor  | Change long-clip size/floor             |
| `OSTRIS_TOOLKIT_ROOT`              | unset                         | AI-Toolkit state resolution            | Resolve toolkit-relative state files    |
| `COMFY_BASE_URL`                   | `http://127.0.0.1:9000`       | ComfyUI integration                    | Point to another ComfyUI origin         |
| `COMFY_WORKFLOWS_DIR`              | repository `comfy-workflows/` | ComfyUI presets                        | Use another preset directory            |
| `COMFY_IMAGE_TIMEOUT`              | `900` seconds                 | ComfyUI processing                     | Change per-image wait time              |
| `DATAFORGE_DB_PATH`                | `backend/data/app.db`         | SQLite app state                       | Relocate app state                      |
| `DATAFORGE_THUMBNAIL_CACHE`        | `backend/data/thumbnails/`    | Thumbnail cache                        | Relocate cached thumbnails              |
| `DATAFORGE_THUMBNAIL_CACHE_MAX_MB` | `2048`                        | Thumbnail pruning                      | Change or disable the cache ceiling     |
| `DATAFORGE_LOG_LEVEL`              | `INFO`                        | Backend logs                           | Change console verbosity                |

Blank string values use the documented defaults for connection and numeric settings. Paths may be
absolute or relative to the process working directory; use absolute paths when launcher working
directories or external tools could make a relative path ambiguous.

## Troubleshooting

### The server answers but ignores images

**Symptom:** text requests work, but captions are generic or unrelated to the media.

For llama.cpp, load the model's separate multimodal projector with `--mmproj <mmproj.gguf>`. Confirm
that `OPENAI_MODEL` matches the exposed model id and that the selected model is vision-capable. A
successful HTTP response only proves the text endpoint works; it does not prove image parts were
processed.

### A large video returns an empty caption

**Symptom:** DataForge logs `api_error`, while the model server reports HTTP `200`,
`finish_reason=stop`, zero completion tokens, and no content. The same clip may work with fewer or
smaller frames.

Model weights, KV cache, and the vision encoder's working buffer share VRAM. If the server allocates
too little working memory when loading the model, a large multi-frame payload can be silently
truncated. A prompt-token count far below the count from a successful run of the same file is a
useful signal.

Free VRAM or reduce the request:

1. Try a smaller quantization or shorter model context.
2. For short clips, set `VIDEO_FRAME_MAX_PIXELS=262144` with the default minimum.
3. For long clips, lower `VIDEO_FRAME_MIN_PIXELS` as well.
4. Reduce `VIDEO_MAX_KEYFRAMES` if frame size alone is not enough.

Restart DataForge after changing `.env`, and reload the model server when changing its model,
quantization, context, or memory allocation.

### Changes do not take effect

1. Confirm the file is project-root `.env`, or remove it if you intended DataForge to load
   `backend/.env`. Only the first existing file is read.
2. Check whether the variable already exists in the launching shell or OS environment; that value
   overrides `.env`.
3. Check spelling and remove surrounding prose or inline comments from the value.
4. Restart DataForge. Vite and server bind settings are read at startup.
5. For model changes, confirm the endpoint's reported model id and restart or reload the model server
   separately.
6. For mode, effort, preserved thinking, audio, verification context, or edit instructions, use the
   job dialog. No similarly named environment variable controls them.

Malformed numeric values generally fall back to their defaults. A nonpositive timeout, invalid port,
or nonpositive media budget may also be ignored rather than producing the intended smaller limit.

### An integration appears unavailable

**OpenAI-compatible endpoint:** make sure the service is running, its URL includes the correct `/v1`
base path, its key is accepted, and `OPENAI_MODEL` names an exposed model. Increase `OPENAI_TIMEOUT`
only when the service is responding but generation legitimately takes longer.

**ComfyUI:** confirm `COMFY_BASE_URL` points to the running origin, not its browser page path. Verify
that `COMFY_WORKFLOWS_DIR` exists and contains API-format JSON workflows. A timeout below 30 seconds
is ignored and returns to `900`.

**AI-Toolkit:** start its separate service at the fixed `http://127.0.0.1:8675` endpoint.
`OSTRIS_TOOLKIT_ROOT` cannot redirect or start it. If jobs appear but state or samples do not, verify
the root and the training folder returned by AI-Toolkit point to accessible local paths.

Restart DataForge after changing any integration variable. Continue with the integration-specific
troubleshooting in the [ComfyUI guide](comfyui.md#troubleshooting) or
[AI-Toolkit guide](ai-toolkit.md#troubleshooting).

## Related guides

- [Documentation home](README.md)
- [Getting started](getting-started.md)
- [Use DataForge day to day](user-guide.md)
- [Process images with ComfyUI](comfyui.md)
- [Train LoRAs with AI-Toolkit](ai-toolkit.md)
- [Develop DataForge](development.md)
