# Configuration

[Documentation](README.md)

DataForge works without any configuration. You only need a `.env` file to connect a vision model, change a port or path, or tune AI jobs. Every variable DataForge reads is listed on this page or, for integrations, in the [ComfyUI](comfyui.md#connect-comfyui) and [AI-Toolkit](ai-toolkit.md#connect-ai-toolkit) guides.

## How settings are loaded

Copy [`.env.example`](../.env.example) to `.env` in the project root, uncomment what you need, and **restart DataForge**. Settings are read only at startup. `.env` is gitignored; keep keys and machine-specific paths there, never in source.

When a setting is defined in more than one place, the highest one wins:

1. Environment variables already set in your shell or OS
2. `.env` in the project root
3. `backend/.env`, read only if there is no project-root `.env`; the two files are never merged
4. Built-in defaults

Blank, malformed, or out-of-range values fall back to their defaults. For example, a zero or negative number never sets a smaller limit. Relative paths resolve against the server's working directory, so prefer absolute ones.

## Connect a vision model

**Auto-caption**, **Verify captions**, and **Edit captions** use any OpenAI-compatible chat-completions server with a vision model. Start one, then add to `.env`:

```dotenv
OPENAI_API_BASE_URL=http://127.0.0.1:8888/v1
OPENAI_MODEL=qwen38
```

Set `OPENAI_MODEL` to the model id the server reports, which is not necessarily the Hugging Face name. Single-model servers often accept any id, but multi-model servers need an exact match.

llama.cpp's `llama-server` listens on 8080 by default, so start it on 8888 and **always load the multimodal projector**. Without `--mmproj`, the server answers happily but ignores the images:

```bash
llama-server --port 8888 -m <model.gguf> --mmproj <mmproj.gguf>
```

If you add `--api-key` to the server, set the same key in `OPENAI_API_KEY`.

### Tested models

| Model                                                                                                         | Notes                                        |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [Qwen3.8 27B](https://huggingface.co/Qwen/Qwen3.8-27B) ([GGUF](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF)) | Recommended; `UD-Q4_K_XL` is a good quant |
| [Qwen3.8 27B Uncensored](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF) | Fewer refusals                               |
| [Qwen3.6 35B A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B)                                                | Recommended MoE                              |
| [Qwen3.6 35B A3B Uncensored](https://huggingface.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive)  | MoE with fewer refusals                      |
| [Qwen3-Omni 30B A3B Instruct](https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct)                        | Needed to caption audio                      |
| [Qwen3 VL 8B Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct)                                      | Fits smaller GPUs                            |

[Gemma 4 31B](https://huggingface.co/google/gemma-4-31B-it) and [Gemma 4 26B A4B](https://huggingface.co/google/gemma-4-26B-A4B-it) also work with some tuning. Use **Instruct** mode, since Gemma has no thinking mode, and set `OPENAI_INSTRUCT_REPEAT_PENALTY=1.1`. Chat templates for these models are in [`llm_templates/`](../llm_templates/).

### Vision model settings

| Variable                  | Default                    | Purpose                                                              |
| ------------------------- | -------------------------- | -------------------------------------------------------------------- |
| `OPENAI_API_BASE_URL`     | `http://127.0.0.1:8888/v1` | Server URL, including the `/v1` path                                 |
| `OPENAI_API_KEY`          | `EMPTY`                    | Only if the server requires a key. `EMPTY` is a placeholder the client needs, not a credential |
| `OPENAI_MODEL`            | `qwen38`                   | Model id as reported by the server                                   |
| `OPENAI_MAX_TOKENS`       | `16384`                    | Cap on each response. Lower it if the server's context is smaller; raise it if answers are cut off |
| `OPENAI_TIMEOUT`          | `600`                      | Seconds to wait for one response. Lower it to detect a dead server sooner |
| `DRAFT_CAPTION_THRESHOLD` | `256`                      | Caption length in characters that counts as finished. See below      |

`DRAFT_CAPTION_THRESHOLD` applies to **Auto-caption** only, in both directions. A caption already longer than the threshold is treated as finished and skipped (`skipped_long` in the results). A generated caption at or below it is retried, and reported as `too_short` if every attempt falls short. Raise it to get longer captions. **Verify captions** and **Edit captions** ignore it, because short edits are fine there.

## Job dialog options

These are set in each job's dialog, not in `.env`. Dialogs remember your choices per folder, and a folder you haven't used yet starts with your most recent choices.

| Option                 | Jobs                 | Effect                                                                                  |
| ---------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| **Mode**               | All three            | **Reasoning** (default for Auto-caption) lets the model think first: slower, often better. **Instruct** (default for the others) answers directly and uses the instruct sampling profile |
| **Reasoning effort**   | All three            | `low`, `medium` (default), or `xhigh`; Reasoning mode only                              |
| **Preserve thinking**  | All three            | Keeps earlier reasoning in multi-turn prompts. On by default; no visible effect on today's single-turn jobs |
| **Caption audio**      | Auto-caption         | Adds the video's audio; see [Audio](#audio). Off by default                             |
| **Additional context** | Verify captions      | Facts about the dataset that the checker should know                                    |
| **Edit instruction**   | Edit captions        | How to rewrite the captions; required                                                   |

**Reasoning effort:** `low` asks for brief thinking and a direct conclusion. `medium` adds no instruction. `xhigh` asks the model to check its assumptions and weigh alternatives. Only these three exist because the shipped Qwen3.8 template rejects other values. The effort is sent both as `reasoning_effort` (read by llama.cpp) and in `chat_template_kwargs` (read by Unsloth- and vLLM-style servers). Only templates that read it change behavior: the Qwen3.8 template does, and the Qwen3.6 and Gemma 4 templates don't.

**Back up captions first** in **Edit captions** is on for every run and never remembered. Overwrite choices in other jobs are never remembered either.

## Media input budgets

These settings control how much of each file reaches the model. Your files are never resized. Stills are downscaled and sent as JPEG. If requests run out of VRAM or context, shrink the input before touching sampling. If captions miss details, raise only the budget that applies to those files. All five apply to **Auto-caption** and **Verify captions**.

| Variable                     | Default   | Controls                                                         |
| ---------------------------- | --------- | ---------------------------------------------------------------- |
| `IMAGE_MAX_PIXELS`           | `1500000` | Pixel budget for a still image, or a GIF's first frame           |
| `VIDEO_KEYFRAMES_PER_SECOND` | `2`       | Frames sampled per second of video, before the cap               |
| `VIDEO_MAX_KEYFRAMES`        | `42`      | Most frames sent per video                                       |
| `VIDEO_FRAME_MAX_PIXELS`     | `500000`  | Pixel budget per frame for clips up to 7 s                       |
| `VIDEO_FRAME_MIN_PIXELS`     | `262144`  | Pixel budget per frame from 20 s on, and the per-side size floor |

A still gets a larger budget than a video frame because it is the only image in its request.

**How video is sampled.** Frames are spread evenly across the clip, including the first and last. The count is `VIDEO_KEYFRAMES_PER_SECOND × ceil(seconds) + 2`, with a minimum of 8 and a maximum of `VIDEO_MAX_KEYFRAMES`. At the defaults, the cap is reached at 20 seconds, so a two-minute clip also sends 42 frames, about one every three seconds. Each frame costs roughly 640 tokens with Qwen: 42 frames are about 27,000 tokens, and 84 are about 54,000.

**How frames are sized.** The per-frame budget falls linearly from the maximum at 7 s to the minimum at 20 s. The minimum also sets a per-side floor on Qwen's 32-pixel grid, 512 × 512 at the default. With that floor, a 1920 × 1080 frame becomes about 928 × 512 at a 500,000 budget, 640 × 512 at 250,000, and 512 × 512 at 125,000. Below the floor, a smaller maximum changes a frame's shape, not its size.

| Symptom                                      | Try                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------- |
| Empty captions or VRAM errors on short clips | `VIDEO_FRAME_MAX_PIXELS=262144`, leaving the minimum at its default  |
| The same on long clips                       | Also lower `VIDEO_FRAME_MIN_PIXELS`; the maximum alone can't go below the floor |
| Short actions missing from long clips        | Raise `VIDEO_MAX_KEYFRAMES`                                          |
| Short clips sampled too sparsely             | Raise `VIDEO_KEYFRAMES_PER_SECOND`; this only helps below the cap    |
| Fine detail missing from short clips         | Raise `VIDEO_FRAME_MAX_PIXELS` rather than adding frames             |
| Fine detail missing from stills              | Raise `IMAGE_MAX_PIXELS`                                             |

### Audio

Audio has no budget setting. With **Caption audio** on, DataForge sends the first 15 seconds of a video's first audio track as 16 kHz mono WAV, in the same request as the frames.

- The model and server must accept OpenAI `input_audio` parts, which means an omni model such as Qwen3-Omni. Vision-only models ignore the audio.
- ffmpeg must be available, or the job won't start.
- Clips without audio are still captioned from their frames, and the finished job reports how many had none.
- Images and GIFs are unaffected, and **Verify captions** never sends audio.

## Sampling

Tune sampling last, once the connection and budgets work. **Reasoning** mode reads the `OPENAI_THINKING_*` variables and **Instruct** mode reads `OPENAI_INSTRUCT_*`. Top-k is shared.

| Reasoning mode                     | Default | Instruct mode                      | Default | What it does                                              |
| ---------------------------------- | ------- | ---------------------------------- | ------- | --------------------------------------------------------- |
| `OPENAI_THINKING_TEMPERATURE`      | `1.0`   | `OPENAI_INSTRUCT_TEMPERATURE`      | `0.7`   | Randomness; lower is more predictable                     |
| `OPENAI_THINKING_TOP_P`            | `0.95`  | `OPENAI_INSTRUCT_TOP_P`            | `0.8`   | Samples only from the most likely tokens that add up to this share |
| `OPENAI_THINKING_MIN_P`            | `0.0`   | `OPENAI_INSTRUCT_MIN_P`            | `0.0`   | Drops tokens far less likely than the top one; `0` is off |
| `OPENAI_THINKING_PRESENCE_PENALTY` | `0.0`   | `OPENAI_INSTRUCT_PRESENCE_PENALTY` | `1.5`   | Discourages returning to concepts already mentioned       |
| `OPENAI_THINKING_REPEAT_PENALTY`   | `1.0`   | `OPENAI_INSTRUCT_REPEAT_PENALTY`   | `1.0`   | Discourages repeated tokens; `1.0` is off and not sent     |
| `OPENAI_TOP_K`                     | `20`    | `OPENAI_TOP_K`                     | `20`    | Samples only from this many most likely tokens            |

Min-p and top-k are passed as server-specific extras (`extra_body`). The repeat penalty is sent with llama.cpp's name, `repeat_penalty`. Servers that expect `repetition_penalty`, such as vLLM, may reject or ignore it, and DataForge does not rename it.

## Server, storage, and logging

| Variable                           | Default                    | Purpose                                                                      |
| ---------------------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `DATAFORGE_UI_PORT`                | `18081`                    | The port you open in the browser. In development, Vite uses it, and the API's CORS allowlist follows it |
| `DATAFORGE_API_PORT`               | `18080`                    | API port during development only; production serves everything on the UI port |
| `DATAFORGE_API_HOST`               | `127.0.0.1`                | Interface to bind. Anything else can expose your datasets to the network. The dev proxy always dials loopback |
| `DATAFORGE_SERVE_UI`               | unset                      | Serves the built UI from the API. The production server sets it; leave it alone |
| `DATAFORGE_DB_PATH`                | `backend/data/app.db`      | SQLite file for settings and job history                                     |
| `DATAFORGE_THUMBNAIL_CACHE`        | `backend/data/thumbnails/` | Thumbnail cache folder                                                       |
| `DATAFORGE_THUMBNAIL_CACHE_MAX_MB` | `2048`                     | Cache size limit, with the least recently used thumbnails removed first; `0` means no limit |
| `DATAFORGE_LOG_LEVEL`              | `INFO`                     | Console verbosity, any standard level such as `DEBUG` or `WARNING`; unknown names use `INFO` |

Folders for the database and cache are created as needed. Launcher and developer variables (`DATAFORGE_PYTHON`, `DATAFORGE_RELOAD`, `DATAFORGE_DISABLE_DOTENV`) are covered in [Getting started](getting-started.md#linux-and-macos) and [Development](development.md#development-variables).

## CPU temperature on Windows

The system specifications panel shows GPU temperature on its own, and CPU temperature on Linux. Windows exposes no CPU temperature that a normal process can read, so on Windows the CPU reading stays hidden until you install a small sensor task. It currently supports AMD Ryzen CPUs only.

1. Install AMD's [Ryzen Master Monitoring SDK](https://www.amd.com/en/developer/ryzen-master-monitoring-sdk.html). Its driver can read the CPU, but only for administrators.
2. Right-click `scripts\install-cpu-temperature-sensor.bat` and choose **Run as administrator**. From a terminal run as administrator, the same works from the project root:

   ```bat
   scripts\install-cpu-temperature-sensor.bat
   ```

   The script reads the temperature once through AMD's CLI and refuses to install if that fails.

This registers a scheduled task named **DataForge CPU temperature**. It starts with Windows, runs as SYSTEM, calls AMD's CLI every two seconds, and writes the result to `%ProgramData%\DataForge\sensors\cpu_temperature.txt`. Only administrators can change that folder. DataForge reads the file and keeps running without elevation. If the task stops, the reading disappears from the panel within 10 seconds instead of going stale.

To remove the task and the folder:

```bat
scripts\install-cpu-temperature-sensor.bat -Uninstall
```

## Data sent to integrations

Every endpoint defaults to your own machine. If you point one at another machine, the data below leaves yours. Check how that server stores and logs requests first.

| Job                      | Sends                                                                           | To                      |
| ------------------------ | ------------------------------------------------------------------------------- | ----------------------- |
| **Auto-caption**         | Downscaled image or video frames, the draft caption, `.sysprompt` instructions, and optionally 15 s of audio | `OPENAI_API_BASE_URL` |
| **Verify captions**      | Downscaled image or video frames, the caption, and any additional context; never audio | `OPENAI_API_BASE_URL` |
| **Edit captions**        | Caption text and your instruction; no media                                      | `OPENAI_API_BASE_URL`   |
| **Process with ComfyUI** | The original media file and the workflow inputs                                  | `COMFY_BASE_URL`        |
| **Quick LoRA training**  | Folder path and training config, including prompts; no media                     | `127.0.0.1:8675` only   |

AI-Toolkit reads the dataset from the path it is given, and its config decides where it writes outputs.

## Troubleshooting

**A change has no effect.**
1. Restart DataForge.
2. Check that a variable of the same name isn't already set in your shell or OS; that value wins.
3. Check that you edited the project-root `.env`. If it exists, `backend/.env` is ignored.
4. Check the spelling, and remove quotes, comments, or other text after the value.
5. Remember that mode, effort, audio, and the other dialog options are not environment variables.
6. For a model change, reload the model server too.

**Captions ignore the image.** The server is running text-only. With llama.cpp, add `--mmproj`. Also check that `OPENAI_MODEL` names a vision model. A successful response only proves the text path works.

**Long videos come back with empty captions.** DataForge logs `api_error`, while the server reports success (`finish_reason=stop`) with zero tokens. The vision encoder ran short of VRAM and silently truncated the request. A prompt-token count far below a successful run of the same file is the telltale sign. Free VRAM with a smaller quant or context, reload the model server, then shrink frames as described in [Media input budgets](#media-input-budgets).

**The model server is unreachable.** Check that it is running, that the URL ends in `/v1`, that the key is accepted, and that `OPENAI_MODEL` matches an id the server exposes. Raise `OPENAI_TIMEOUT` only if the server responds but is slow.

For ComfyUI and AI-Toolkit, see [ComfyUI troubleshooting](comfyui.md#troubleshooting) and [AI-Toolkit troubleshooting](ai-toolkit.md#troubleshooting).
