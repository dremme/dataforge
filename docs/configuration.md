# Configuration

[Documentation](README.md)

Use **Settings** to connect services and tune AI jobs. Browsing, manual captioning, editing, and local checks work without a model or `.env` file. Environment variables cover startup options and provide defaults for Settings. Integration-specific options are in the [ComfyUI](comfyui.md#connect-comfyui) and [AI-Toolkit](ai-toolkit.md#connect-ai-toolkit) guides.

## Connect a vision model

Auto-caption and Verify captions need an OpenAI-compatible chat-completions server that accepts images. Edit captions sends text only. Install and run the model server separately, then:

1. Open **Settings > Vision model > Server** (`Ctrl+,`).
2. Enter the API URL, including `/v1`, and a key if required. The default URL is `http://127.0.0.1:8888/v1`.
3. Select **Test connection**. It tests the entered address/key and lists model ids reported by the server.
4. Choose the server's model id, then **Save**. The default `qwen38` is an id, not a model download.
5. Open your dataset and use **Create instructions** to provide a system prompt, or inherit one from a parent. Run Auto-caption on a small selection first.

Testing checks the server's model-list endpoint; it does not prove vision or audio input works. A saved key is never displayed again. If you leave the key field blank during a connection test, the saved/environment key is used.

For llama.cpp, download the model in GGUF format and its matching multimodal projector, which lets the model process images. Load both:

```bash
llama-server --port 8888 -m <model.gguf> --mmproj <mmproj.gguf>
```

Some download-based llama.cpp setups load the projector automatically; see its [multimodal instructions](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md). Match a server's `--api-key` value in Settings if authentication is enabled.

### Tested models

**Qwen3.8 27B is the recommended starting point.** For llama.cpp, try the `UD-Q4_K_XL` [GGUF quantization](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF). Quantization reduces the memory needed for model weights; leave room for context and media input as well.

| Model                                                                                                                     | When to choose it                                     | Setup notes                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [Qwen3.8 27B](https://huggingface.co/Qwen/Qwen3.8-27B)                                                                    | Default recommendation for image and video captioning | Start in Reasoning; the bundled template supports low, medium, and xhigh effort                                                         |
| [Qwen3.6 35B A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B)                                                            | Recommended mixture-of-experts (MoE) alternative      | Activates about 3B of its 35B parameters per token; memory still needs to accommodate the full weights. Supports Reasoning and Instruct |
| [Qwen3 VL 8B Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct)                                                  | Smaller model for more limited memory                 | Use Instruct; choose a quantization that fits alongside the media/context budget                                                        |
| [Qwen3-Omni 30B A3B Instruct](https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct)                                    | Caption video audio as well as frames                 | Use Instruct and enable Caption audio; the server must accept `input_audio` parts                                                       |
| [Gemma 4 31B](https://huggingface.co/google/gemma-4-31B-it) / [26B A4B](https://huggingface.co/google/gemma-4-26B-A4B-it) | Alternative dense / MoE models                        | A project starting point is Instruct with repeat penalty `1.1`. The bundled template also supports thinking, but ignores effort         |

Community variants of [Qwen3.8 27B](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF) and [Qwen3.6 35B A3B](https://huggingface.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive) aim to reduce refusals. Evaluate their captions on a small representative selection before a full run.

Load the matching projector and a compatible chat template for your model. Templates for Qwen3.8, Qwen3.6, and Gemma 4 are in [`llm_templates/`](../llm_templates/). Hardware needs depend on quantization, context, and media budgets; DataForge itself needs no GPU.

### Vision model settings

All fields below except `OPENAI_TIMEOUT` are under **Settings > Vision model > Server**.

| Variable                  | Default                    | Accepted value / effect                                                                                |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `OPENAI_API_BASE_URL`     | `http://127.0.0.1:8888/v1` | HTTP(S) URL for the OpenAI-compatible API, including `/v1`                                             |
| `OPENAI_API_KEY`          | `EMPTY`                    | Nonempty key, at most 500 characters, without whitespace; `EMPTY` is the client placeholder for no key |
| `OPENAI_MODEL`            | `qwen38`                   | Nonempty model id, at most 200 characters; use the server's id                                         |
| `OPENAI_MAX_TOKENS`       | `16384`                    | Integer ≥ 1; response cap, including any reasoning the server counts                                   |
| `OPENAI_TOP_K`            | `20`                       | Integer ≥ 0; server-specific top-k sampling                                                            |
| `DRAFT_CAPTION_THRESHOLD` | `256`                      | Integer ≥ 1; caption length in characters, for Auto-caption only                                       |
| `OPENAI_TIMEOUT`          | `600`                      | Positive seconds per response; nonpositive or malformed values use the default                         |

**Auto-caption threshold:** an existing caption longer than the threshold is skipped (`skipped_long`). Generated text at or below the threshold is retried, then reported as `too_short` if all attempts fail. Equal to the threshold is still a draft. Raise it when you require longer captions, and make sure the system prompt asks for enough detail. **Verify captions** and **Edit captions** ignore this threshold. Model calls allow up to three attempts; the client's connection timeout is 10 seconds.

## Save, reset, and clear

**Save** applies edited fields without restarting; section dots mark unsaved changes. **Cancel** discards field changes, including the previewed appearance. Each configurable field identifies whether it uses a saved value, the environment, or its default. **Reset**, then Save, removes a saved override.

| Section            | Controls                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Appearance**     | Light, dark, or System theme; previewed before saving. Quick actions can switch directly                    |
| **Vision model**   | Server connection/limits, separate Reasoning and Instruct sampling, image/video input budgets               |
| **Integrations**   | ComfyUI and AI-Toolkit origins, each with Test connection                                                   |
| **Storage**        | Thumbnail-cache size/limit and **Clear cache**; thumbnails regenerate as you browse                         |
| **Data & history** | Job/notification retention; **Clear** for recent folders/actions, per-folder job options, and display modes |
| **About**          | Version, runtimes, GPU, and storage/config paths; **Copy diagnostics** excludes the API key                 |

**Clear** actions apply immediately and are not undone by Cancel. They clear app history/cache, not dataset media or captions. Finish or cancel a running AI job before retuning: it retains its connection, while other settings can change during processing.

## Job dialog options

Choose **Reasoning** to let the model think before answering, or **Instruct** for a direct response. These and the options below are dialog choices, not environment variables. Most are remembered per folder, with the latest choices as the starting point for a new folder.

| Option                 | Jobs                                         | Default / behavior                                                                                                             |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Mode**               | Auto-caption, Verify captions, Edit captions | Reasoning for Auto-caption and Verify captions; Instruct for Edit captions. Chooses the sampling profile and thinking controls |
| **Reasoning effort**   | All three                                    | `medium`; also `low` and `xhigh`, in Reasoning mode only                                                                       |
| **Preserve thinking**  | All three                                    | On; retains earlier reasoning in multi-turn prompts when the template supports it. Current jobs use single-turn prompts        |
| **Caption audio**      | Auto-caption                                 | Off; sends audio alongside video frames                                                                                        |
| **Additional context** | Verify captions                              | Optional dataset facts for the checker                                                                                         |
| **Edit instruction**   | Edit captions                                | Required text describing the rewrite                                                                                           |

**Back up captions first** in Edit captions starts enabled every run and is not remembered. Set captions, Backup captions, and Watermark also require overwrite permission anew.

Auto-adjust's **Replace earlier adjustments** and **Reset all color adjustments to zero** start off every run.

ComfyUI remembers prompt and seed per preset, its last preset globally, and overwrite permission per folder. **Keep original metadata** is remembered across individual and bulk candidate acceptance and is on by default. See [candidate review](comfyui.md#review-candidates) for supported formats.

## Media input budgets

Tune **Settings > Vision model > Media input** when captions miss detail or requests exceed GPU memory or context (the model's capacity for input and response tokens). Adjust input budgets before sampling: more frames and pixels use more memory and context.

| Problem                               | Change                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| Images miss fine detail               | Raise **Image pixel budget**                                                   |
| Short clips exhaust memory            | Lower **Frame pixel budget, short clips**, for example to `262144`             |
| Long clips still exhaust memory       | Also lower **Frame pixel budget, long clips**, which controls the resize floor |
| Brief actions disappear in long clips | Raise **Max keyframes**                                                        |
| Short clips need more samples         | Raise **Keyframes per second**; it helps only below the cap                    |
| Short clips miss fine detail          | Raise the short-clip frame budget                                              |

### Defaults and sampling rules

All five are positive integers under **Settings > Vision model > Media input**. They apply to Auto-caption and Verify captions. Originals are unchanged; request images are converted to JPEG.

| Variable                     | Default   | Controls                                                   |
| ---------------------------- | --------- | ---------------------------------------------------------- |
| `IMAGE_MAX_PIXELS`           | `1500000` | Pixel budget for a still or a GIF's first frame            |
| `VIDEO_KEYFRAMES_PER_SECOND` | `2`       | Requested frames per second, before the cap                |
| `VIDEO_MAX_KEYFRAMES`        | `42`      | Maximum frames sent per video                              |
| `VIDEO_FRAME_MAX_PIXELS`     | `500000`  | Per-frame pixel budget for clips up to 7 seconds           |
| `VIDEO_FRAME_MIN_PIXELS`     | `262144`  | Long-clip budget and the basis for the per-side size floor |

**Frame count:** for a known duration, DataForge requests `min(max(fps × ceil(seconds) + 2, 8), max_keyframes)` evenly spaced frames, including endpoints. The maximum can be set below 8. Unknown duration uses 8 frames. At the defaults, the cap is reached at 20 seconds; a two-minute clip also sends 42 frames. The decoded frame count can further limit sampling.

**Frame size:** the budget falls linearly between 7 and 20 seconds, from the maximum to the smaller of the maximum and minimum settings. For larger images, each resized side is rounded down to a multiple of 32, then clamped to a floor derived from `sqrt(VIDEO_FRAME_MIN_PIXELS)`, rounded down to that grid and bounded to 32–512 pixels. This resize rule also applies to stills. An image already within its pixel budget is sent at its original size.

At the default floor, a 1920 × 1080 frame becomes 928 × 512 with a 500,000-pixel budget, 640 × 512 at 250,000, and 512 × 512 at 125,000. The floor can exceed the requested pixel budget and change the aspect ratio. Lower the minimum as well as the maximum to shrink below that floor. Actual vision-token use depends on the model and server; frame counts alone do not determine it.

### Audio

**Caption audio** sends the first 15 seconds of a video's first audio track as 16 kHz mono WAV, in the same request as its frames. There is no audio budget setting. The server and model must accept OpenAI `input_audio` parts; a vision-only setup may reject or ignore them.

The job requires ffmpeg. A video without audio is still captioned from frames, and the result reports that it had no audio. Images, GIFs, and Verify captions never send audio.

## Sampling

Tune sampling once the connection and media budgets work. Reasoning and Instruct each use their own profile.

All sampling fields are available under **Settings > Vision model**: the two profiles in **Sampling**, and top-k in **Server**.

| Reasoning variable                 | Default | Instruct variable                  | Default | Range / meaning                                                          |
| ---------------------------------- | ------- | ---------------------------------- | ------- | ------------------------------------------------------------------------ |
| `OPENAI_THINKING_TEMPERATURE`      | `1.0`   | `OPENAI_INSTRUCT_TEMPERATURE`      | `0.7`   | 0–2; randomness, with lower values more predictable                      |
| `OPENAI_THINKING_TOP_P`            | `0.95`  | `OPENAI_INSTRUCT_TOP_P`            | `0.8`   | 0.01–1; probability mass retained for sampling                           |
| `OPENAI_THINKING_MIN_P`            | `0.0`   | `OPENAI_INSTRUCT_MIN_P`            | `0.0`   | 0–1; removes tokens unlikely relative to the best token; 0 disables it   |
| `OPENAI_THINKING_PRESENCE_PENALTY` | `0.0`   | `OPENAI_INSTRUCT_PRESENCE_PENALTY` | `1.5`   | −2–2; positive values discourage returning to concepts already mentioned |
| `OPENAI_THINKING_REPEAT_PENALTY`   | `1.0`   | `OPENAI_INSTRUCT_REPEAT_PENALTY`   | `1.0`   | 0–2; 1 disables it and omits the parameter                               |

Min-p and top-k are sent in `extra_body`. The repeat penalty uses `repeat_penalty`, the llama.cpp parameter name. A server expecting `repetition_penalty` may reject or ignore it; DataForge does not rename it.

Instruct sends `chat_template_kwargs.enable_thinking=false`. Reasoning sends effort both as `reasoning_effort` and in `chat_template_kwargs`, along with `preserve_thinking`. Whether those controls work depends on the server and its chat template.

The [bundled templates](../llm_templates/) format messages and thinking controls for each model. Qwen3.8 accepts only `low`, `medium`, and `xhigh`: low adds instructions for brief thinking, medium adds none, and xhigh adds instructions to check assumptions and alternatives. The Qwen3.6 and Gemma 4 templates support thinking but do not use the effort value.

## How settings are loaded

Copy [`.env.example`](../.env.example) to `.env` in the project root, uncomment the values you need, and restart DataForge. The file is gitignored. Keep keys and machine-specific paths there, never in source.

For settings available in the app, precedence is:

1. A value saved in **Settings**, stored in the database
2. An environment variable already set in the shell or OS
3. The project-root `.env`, or `backend/.env` only when the root file does not exist
4. The built-in default

The two `.env` files are never merged. Environment changes require a restart. To make an environment value apply instead of a saved one, select **Reset**, then **Save**, in Settings.

Settings validates values before saving. Blank, malformed, or out-of-range environment values for those same fields fall back to defaults. Zero is valid where a table below allows it. Environment-only settings have their own parsing rules; ports must be usable TCP ports, and invalid paths or bind addresses can prevent startup.

Default paths are relative to the project location. Explicit relative path overrides resolve against the server's working directory, normally `backend/` with the bundled launchers. Prefer absolute overrides.

## Server, storage, and logging

| Variable                              | Default                    | Where / effect                                                                                                                                |
| ------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATAFORGE_UI_PORT`                   | `18081`                    | Environment-only port, 1–65535; production UI/API, or Vite and the CORS allowlist in development                                              |
| `DATAFORGE_API_PORT`                  | `18080`                    | Environment-only port, 1–65535; development API only                                                                                          |
| `DATAFORGE_API_HOST`                  | `127.0.0.1`                | Environment-only bind address. A non-loopback address can expose dataset access to the network; the dev proxy still connects to loopback. The API answers only to loopback names and this address (any name when bound to `0.0.0.0` or `::`), and refuses state-changing requests from other origins      |
| `DATAFORGE_SERVE_UI`                  | unset / off                | Environment-only flag; production sets it automatically to serve `frontend/dist`. Leave unset in development                                  |
| `DATAFORGE_DB_PATH`                   | `backend/data/app.db`      | Environment-only SQLite path for settings, jobs, and notifications                                                                            |
| `DATAFORGE_THUMBNAIL_CACHE`           | `backend/data/thumbnails/` | Environment-only thumbnail directory                                                                                                          |
| `DATAFORGE_THUMBNAIL_CACHE_MAX_MB`    | `2048`                     | Settings > Storage; integer ≥ 0, in units of 1024² bytes; removes least recently used thumbnails above the limit. 0 disables the size limit   |
| `DATAFORGE_JOB_HISTORY_DAYS`          | `30`                       | Settings > Data & history; integer ≥ 0 days; removes old finished jobs, never running jobs. 0 disables age-based pruning                      |
| `DATAFORGE_NOTIFICATION_HISTORY_DAYS` | `3`                        | Settings > Data & history; integer ≥ 0 days; removes old notifications. 0 disables age-based pruning; the feed still keeps at most 50 entries |
| `DATAFORGE_LOG_LEVEL`                 | `INFO`                     | Environment-only standard log level, such as `DEBUG` or `WARNING`; unknown names use `INFO`                                                   |

Database and cache directories are created as needed. History pruning runs at startup, hourly, and after saving a retention change. Clearing thumbnails or remembered data in Settings applies immediately; Cancel does not undo it.

For `DATAFORGE_SERVE_UI`, `0`, `false`, `no`, `off`, or blank means off; other set values mean on. Launcher and test variables are listed in [Development](development.md#development-variables).

## CPU temperature on Windows

The system specifications panel reads GPU temperature when available and attempts CPU temperature on Linux. On Windows, the optional sensor task currently supports AMD Ryzen only.

1. Install AMD's [Ryzen Master Monitoring SDK](https://www.amd.com/en/developer/ryzen-master-monitoring-sdk.html).
2. Right-click `scripts\install-cpu-temperature-sensor.bat` and choose **Run as administrator**, or run it from an administrator terminal at the project root:

   ```bat
   scripts\install-cpu-temperature-sensor.bat
   ```

The installer tests AMD's CLI before registering **DataForge CPU temperature**. The task starts with Windows, runs as SYSTEM, polls every two seconds, and writes `%ProgramData%\DataForge\sensors\cpu_temperature.txt` in an administrator-controlled folder. DataForge reads that file without elevation. Readings older than 10 seconds are hidden.

To remove the task and sensor folder, run from an administrator terminal:

```bat
scripts\install-cpu-temperature-sensor.bat -Uninstall
```

## Data sent to integrations

The default endpoints are local. Using a remote endpoint sends the following data to that server; its own storage and logging policies apply.

| Job                  | Sends                                                                                                    | Destination           |
| -------------------- | -------------------------------------------------------------------------------------------------------- | --------------------- |
| Auto-caption         | Downscaled image/video frames, draft caption, system-prompt instructions, optionally 15 seconds of audio | `OPENAI_API_BASE_URL` |
| Verify captions      | Downscaled image/video frames, caption, additional context; no audio                                     | `OPENAI_API_BASE_URL` |
| Edit captions        | Caption and edit instruction; no media                                                                   | `OPENAI_API_BASE_URL` |
| Process with ComfyUI | Source media and workflow inputs                                                                         | `COMFY_BASE_URL`      |
| Quick LoRA training  | Dataset folder path and training configuration, including prompts; no media upload                       | `OSTRIS_BASE_URL`     |

AI-Toolkit must be able to read the supplied dataset path. Its configuration controls output locations; DataForge also needs filesystem access to its state and samples to display them.

## Troubleshooting

**The server is unreachable.** Test the connection before saving. Check the server is running, the URL includes `/v1`, the key is accepted, and the selected model id exists. Increase `OPENAI_TIMEOUT` only for a server that connects but responds slowly.

**Captions ignore the image.** Check the server is serving a vision model and has loaded its projector. A successful connection test only checks the model-list endpoint.

**Captions are empty, cut off, or fail on long clips.** Check both server logs and per-file job results. Empty content can indicate exhausted GPU memory/context or unsupported thinking output. Shrink media budgets first; adjust response/context limits for truncated answers. Reload the model server if needed.

**A setting change has no effect.** Save UI changes. For `.env` changes, restart DataForge and check for a saved override, an OS/shell override, or a root `.env` hiding `backend/.env`. Check spelling and value ranges. Dialog options are separate from environment settings. See [precedence](#how-settings-are-loaded).

For integration failures, see [ComfyUI](comfyui.md#troubleshooting) or [AI-Toolkit](ai-toolkit.md#troubleshooting).
