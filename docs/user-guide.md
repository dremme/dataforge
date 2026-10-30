# User guide

[Documentation](README.md)

A dataset is a folder: `scene.jpg` uses `scene.txt` beside it. DataForge reads and writes those files directly, and the gallery updates when files change outside the app. The gallery shows the open folder's media, not its subfolders.

## Browse and organize

### Find files

- **Search** (`Ctrl+F` or `/`) matches file names, folder names, captions, and [tags](#tags). Turn on regex for regular expressions. A pattern that takes more than a second is stopped and reported as **Pattern too slow**.
- **Filters** narrow by media type, caption state, issues, edits, duplicates, or ComfyUI results. Each active filter gets a removable chip; **Reset all filters** keeps the search text.
- **Sort** by name, date modified, caption length, megapixels, or duration. The sort is remembered.
- **View** as large cards, small cards, or a list. Each folder remembers its view.
- The **captioned** and **issue** counts in the toolbar filter to those files; click again to clear.

Cards mark missing, empty, and unreadable captions, and show badges for findings, ComfyUI candidates, and edits. Hovering a card shows its actions: Open, Copy caption, and Delete by default. **Settings > Appearance > Gallery** adds others from the inspector, such as Edit, Move file, or Rename file. The **statistics** drawer covers the whole folder, ignoring filters: caption coverage and lengths, frequent words and tags, issues, duplicates, formats, durations, megapixels, aspect ratios, and files whose size or length could not be read.

### Layout

| Area | What it holds |
| --- | --- |
| Folder sidebar | **Open video editor**, **Settings**, favorites, and recent folders. Hover a folder for its path and to favorite or remove it |
| Toolbar | Search, filters, sort, view, **Review**, **Tools**, and the CPU button for CPU, RAM, and GPU details |
| Subfolder cards | Above the media; hover for caption coverage and review counts |
| Inspector | The open file's caption and details, beside the gallery |

Collapse the sidebar for more space. Below 1600px wide it starts collapsed; below 1200px it opens over the gallery and closes with `Escape` or a click outside. Breadcrumbs navigate up, and you can copy the folder path or, on Windows, open it in File Explorer.

**Review** appears when there are findings. It opens caption issues, duplicate groups, or ComfyUI candidates for the same [scope as jobs](#scope), and says which scope at the top. A duplicate group always opens with all its members.

Press `Ctrl+P` for **Quick actions**: search jobs, commands, filters, and folders, then press Enter. Press `?` for the shortcut list.

### Select, copy, move, rename, delete

- **Select** enters selection mode. `Ctrl+click` toggles a file; `Ctrl+A` selects every file the search and filters show.
- The selection bar can invert or clear the selection, copy, move, or delete. Toolbar tools then run on the selection.
- A filter hides selected files from every action until they are visible again; they stay selected.
- Copy and move preview conflicts and ask before overwriting. If an overwrite fails, DataForge tries to restore the previous destination file.
- **Rename** (a Tool) gives sequential numbered names and has no undo. To rename one file, use the pencil in the inspector; the extension stays. Rename an empty folder from its empty view or Quick actions.
- Create subfolders, or drag media and `.txt` captions into the app to import them. An import takes only the files you drop.

Copy, move, rename, and delete take a file's [related files](#files-dataforge-creates) along: caption, findings, edit original, caption backup, and staged ComfyUI result. Folder instructions stay with the folder. On Windows, deleting uses the Recycle Bin; elsewhere it is permanent after confirmation. If a related file cannot be removed, the notice names it and offers **Retry**.

A file that another operation is changing, such as an edit render or a ComfyUI acceptance, is refused until that operation finishes. Bulk jobs report such files as busy and continue.

### Video playback

Videos start muted and loop. A video the browser cannot play, such as an MPEG-4 Part 2 `.mp4`, says so over the player. **Convert to H.264** re-encodes it in place like any edit: the original is kept, and **Revert original** restores it. Editing and frame capture wait until the video plays.

## Captions

Click a file to edit its caption in the inspector. Its header shows the file's position with previous and next buttons; the arrow keys page through files while the gallery has focus. **Expand media view** opens a larger view with the same draft, and the choice is remembered. Narrow windows use an overlay. Resize the inspector by dragging its left edge, or with the arrow keys on the focused separator.

The media view and issue resolver show the modified date, dimensions, megapixels, aspect ratio, and any embedded ComfyUI workflow.

**Autosave.** Captions save as you type, with surrounding whitespace trimmed. Changing files, closing, and navigating wait for the save.

| Situation | What you can do |
| --- | --- |
| The save failed | Retry, discard the draft and continue, or keep editing |
| The caption changed on disk since you opened it (**Changed elsewhere**) | **Reload** the file's text, or **Overwrite** it with yours |
| The caption could not be opened, for example while another program has it locked | The editor stays read-only; **Retry** once it is free |
| The caption is not UTF-8 text | The editor stays read-only; **Replace caption** writes new text over it |
| You want the text you opened with | **Revert** |
| The folder has a [backup](#caption-backups) of this caption | **Compare backup** shows struck-through words that would go and highlighted words that would return; **Use backup** loads it. `Escape` returns to editing |

Type two characters or press `Ctrl+Space` for word completions from the folder's captions. `Ctrl+Enter` saves and moves to the next file. The token count marked `~` is an estimate from text length, not a model tokenizer.

### Folder instructions

Choose **Create instructions** or **Edit instructions** above the gallery. There are two tabs:

| Tab | File | Used by |
| --- | --- | --- |
| **System prompt** | `.sysprompt` | Auto-caption, which needs one in this folder or a parent. It sets voice, required details, or format |
| **Caption rules** | `.captionrules` | **Lint captions**. **Use template** gives a starting point |

Each file applies to subfolders that have no file of their own. The nearest one wins whole; the two are never merged, and each inherits on its own. The editor marks inherited instructions, and **Copy from parent** makes a local copy.

**Save** writes the changed tabs to the current folder; **Reset** discards the open tab's changes. Tabs do not autosave, and closing with unsaved changes asks first. Saving a tab empty removes the local file so inheritance resumes. An empty file made outside the app still blocks inheritance, and invalid inherited rules are reported, not skipped.

### Caption issues

1. Run **Verify captions** for a model check against the media, or **Lint captions** for a local rule check.
2. Open **Review > Caption issues** to step through findings.
3. Correct the caption, mark it resolved (`Ctrl+Enter`), and continue with the arrow keys.

Both checks write `.issue.json` findings and leave captions unchanged. Model and rule findings are kept apart; rerunning one check replaces only its own. Still images can be zoomed and, on Windows, opened in the system viewer. **Delete all .issue.json files** in Quick actions clears findings.

### Caption rules

Linting needs no model. Edit the rules in folder instructions, run **Lint captions**, then filter by **With issues** or open the resolver. [`sample_media/`](../sample_media/) has an example.

```yaml
trigger: sample_style
words:
  min: 8
  max: 120
repeated_phrases: 4
flag:
  - match: [float*, hover*, suspended]
    note: check the subject is really off the ground
  - match: in the background
```

Every setting is optional, but at least one rule must be active. Unknown keys are rejected, including inside `words` and `flag` entries.

| Setting | Value | Flags a caption that... |
| --- | --- | --- |
| `trigger` | Text | Does not start with this term, case-sensitive, at a word boundary |
| `words.min` / `words.max` | Integers ≥ 1, min ≤ max; set at least one | Has fewer or more whitespace-separated words (limits inclusive) |
| `repeated_phrases` | Integer ≥ 2 | Repeats a phrase of at least this many words, ignoring case and punctuation |
| `flag[].match` | A term or a list of terms | Contains any term as a whole word or phrase, ignoring case |
| `flag[].note` | Text, optional | (Shown with that rule's finding) |

Terms are literal text, not regular expressions. A trailing `*` matches word endings: `float*` catches `floating`. A term needs text besides the `*`. Phrases match across line breaks. Repeats are counted without overlap, and contractions count as words.

Missing caption files are skipped; an empty caption is checked. Each file keeps at most five rule findings; the fifth summarizes any further hits.

### Duplicates

**Find duplicates** groups visually similar files by perceptual hash, a compact fingerprint of appearance, with exact, near, or loose matching. The resolver suggests a keeper, usually the largest file. Keep one and delete the rest, or dismiss the group to keep all. **Delete all .duplicate.json files** clears findings without deleting media.

### Caption backups

Back up before a bulk rewrite you may want to undo.

- **Backup captions** copies `.txt` files into `.backup/`, overwriting older copies.
- **Edit captions** and **Find & replace** start with **Back up captions first** on, so the backup holds the caption from just before the latest edit.
- **Restore captions** reviews every caption that differs from its backup, with thumbnails and word-by-word changes, inline or side by side. Filter by changed, new, or unreadable, or by name or text; the restore still covers everything under **All**. It skips files whose media is gone and keeps the backups.

Neither backup nor restore changes issue findings.

**Try an edit first.** In **Edit captions**, enter an instruction and click **Dry run**. It rewrites up to three readable captions from the dialog's scope, in filename order, with the job's model settings. Removed and added text is highlighted, and nothing is written. Changing the instruction or model clears it. The full job generates fresh text, so its wording can differ. With **Send media** on, the model also sees each file's image or video keyframes, so an instruction such as "add clothing colours" can use what the picture shows.

## Tags

DataForge tags the images, GIFs, and videos in your **favorite folders** in the background, so you can search for what files show. Subfolders are tagged only if they are favorites too. Audio is skipped, and a changed file is tagged again.

- **Search** matches tags like caption text. **Large cards** show the strongest tags; turn that off in **Settings > Appearance > Gallery**.
- **While tagging**, the folder's sidebar favorite pulses green and its header shows a slow green sweep.
- **Settings > Tagging** shows the status and the waiting files. **Minimum confidence** hides weaker tags immediately, without re-tagging.

**Your own terms.** Tags come from [YOLO-World](https://docs.ultralytics.com/models/yolo-world/), which looks for about 300 built-in everyday objects, people, and scenery. Add terms in `backend/data/tag_vocabulary.txt`, one per line (`#` starts a comment). The file is not checked into Git and is picked up without a restart; every favorite is then re-tagged. Short, visible things such as `red dress` work best. The detector finds objects, not moods or styles, and near-synonyms like `woman` and `female` split one object's score.

**Install.** Setup installs tagging, a few GB the first time; skip it with `setup.bat -SkipTagging` or `./setup.sh --skip-tagging`. It picks the PyTorch build for your GPU (CUDA, ROCm on Linux, or CPU) and downloads the model into `backend/data/models/`: `yolov8x-worldv2` on NVIDIA GPUs, otherwise the faster, less precise `yolov8s-worldv2`. If that fails, setup still finishes and **Settings > Tagging** says what is missing; run setup again to retry. To install by hand, follow the header of `backend/requirements-tagging.txt`.

## Edit media

Open a file's editor, make changes, then **Apply**. The first edit keeps the original beside the file as `<name>.bak`, with the edit settings in `<name>.edit.json`. Every later edit renders from that original again. **Revert original** restores it and removes both files.

If the file is replaced outside DataForge, the next edit or revert treats the replacement as the new original and discards the old original and settings (to the Recycle Bin on Windows).

| Media | Formats | Tools |
| --- | --- | --- |
| Images | JPG/JPEG, PNG, WebP, BMP | Crop to a ratio or freely, rotate by quarter turns, mirror, resize by scale or exact size, Adjust, masks |
| Videos | MP4, MOV, M4V the browser can play | Trim, crop, resize, speed, volume, mute, Adjust, masks. Rendering shows progress and can be cancelled |
| Audio | WAV, MP3, FLAC | Trim, fades, volume, speed, pitch, EQ, noise reduction; see [Edit audio](#edit-audio) |

- **Masks** blur, pixelate, or black out regions.
- **Save frame as JPG** writes a video or GIF frame beside the source, named with its timestamp or frame number.
- **GIF to MP4** converts at 24 fps and asks before overwriting an MP4 of the same name.
- While you resize a crop, the preview shows its pixel size; a free crop also shows its ratio.

### Adjust in the editor

Adjust has Exposure, Brilliance, Highlights, Shadows, Contrast, Brightness, Black Point, White Point, Saturation, Vibrance, Warmth, Tint, Hue, Definition, and Noise Reduction. Choose a tool, then drag or click its slider, or use the arrow keys (Shift for larger steps). Double-click a slider to return it to its marked resting value. Scroll the tool row with the mouse wheel when it does not fit.

The **Auto** wand analyzes the original inside the crop, ignoring masks; for videos, it samples the trimmed range. It corrects exposure, contrast, color intensity, and color casts toward a natural look. Its slider sets the amount; click the wand again to turn it off.

Hold the compare button to see the original. Click the preview to inspect at output resolution when that is larger than the display, then move the pointer to pan. Live preview needs WebGL 2; saving works without it.

### Edit audio

The audio editor plays the original while you work.

| Tool | What it does |
| --- | --- |
| **Trim** | Drag the waveform handles or set them at the playhead; length presets keep that many seconds |
| **Fades** | Fade in and out over the chosen seconds. **Equal power** sounds even; **Linear** dips in the middle |
| **Volume** | Gain from 25% to 200%. **Limit peaks** holds peaks under -1 dB; **Normalize** brings the sound to -14 LUFS, then limits peaks. The preview plays a normalize at its measured gain but does not limit |
| **Speed** / **Pitch** | Speed changes the length and keeps the pitch; pitch moves up to 12 semitones either way and keeps the length |
| **EQ** | **Low cut** removes rumble, **High cut** hiss; **Bass**, **Mid**, and **Treble** move their range by up to 12 dB |
| **Clean** | Noise reduction learns the noise from the quietest half second and lowers it by up to 30 dB |

Noise reduction and pitch render on the server before you hear them (**Preparing preview...**), and the saved file uses that same render. A file keeps its format: a WAV its sample format, a FLAC its bit depth, and an MP3 its bitrate, tags, and cover. An MP3 is re-encoded once per edit, always from the original.

### Auto-adjust a batch

**Auto-adjust** applies the wand to each eligible image and video and saves it. Crops, masks, trims, and other edits stay. Manual Adjust values stay too, and an earlier Auto result is replaced, not stacked. Originals are kept, so you can tune or revert each file in its editor. Unchanged files are skipped, and cancelling keeps the finished files.

Two options start off every run:

- **Replace earlier adjustments** resets every Adjust tool before applying Auto, discarding manual values.
- **Reset all color adjustments to zero** clears manual and Auto color without applying Auto. Other edits stay.

## Video editor

Combine videos, stills, audio, and titles on a multi-track timeline and export an MP4; see the [Video editor guide](video-editor.md).

## Jobs

### Scope

A job runs on the first of these that applies:

1. The selected files that are visible.
2. The files the search and filters show, when either is active.
3. The whole folder.

The dialog shows the count and freezes the file list when it opens, previews included. An empty scope cannot start a job. **Quick LoRA training** is the exception: it always uses the whole folder, and its dialog says so.

### Running and history

Jobs run in the background, one per folder at a time. While one runs, **Cancel job** replaces Auto-caption and Tools, and the strip under the toolbar shows progress, the current file, and the time left. Cancelling keeps what was already written.

A clean finish leaves no strip. After a failure, cancellation, warnings, or failed files, the strip stays until dismissed: **Retry N failed** reruns the failures, and **Run again** uses the current scope. **Job details** opens the Jobs drawer with warnings, logs, per-file results, training samples, and earlier runs. Finished runs are kept for the [job history](configuration.md#server-storage-and-logging) period, 30 days by default.

### Job reference

| Job | Writes | Notes |
| --- | --- | --- |
| **Auto-caption** | `.txt` captions | Expands short drafts and captions files that have none, from the media and the [system prompt](#folder-instructions). Skips captions over the [draft threshold](configuration.md#vision-model-settings). The dialog counts what it will do first |
| **Verify captions** | `.issue.json` findings | A model checks each caption against its media; captions stay unchanged |
| **Lint captions** | `.issue.json` findings | Local [caption rules](#caption-rules); no model |
| **Edit captions** | `.txt` captions | A model rewrites captions to your instruction; it sees the media only with **Send media**. Backs up first by default |
| **Set captions** | `.txt` captions | One caption for every file; overwriting existing captions needs permission |
| **Find & replace** | `.txt` captions | Text or regex replace, or add a prefix or suffix. Regex `^` and `$` match at each line. Previews counts and examples first; backs up first by default |
| **Find duplicates** | `.duplicate.json` groups | Deletes media only when you confirm in the resolver |
| **Backup captions** / **Restore captions** | `.backup/` copies / `.txt` captions | See [Caption backups](#caption-backups) |
| **Rename** | New file names | Sequential, with related files; no undo |
| **Watermark** | Copies in `watermarked/` | Text, a PNG such as a logo, or both, each with its own size, opacity, and position. The PNG is kept for later runs. Overwrites earlier copies; captions are not copied. Can strip metadata from the copies |
| **Strip metadata** | Files in place | Removes EXIF, XMP, text and workflow metadata, video tags, and chapters. Keeps image color and density data and every video and audio stream; video is remuxed, not re-encoded. No undo |
| **Auto-adjust** | Files in place, originals kept | See [Auto-adjust a batch](#auto-adjust-a-batch) |
| **Process with ComfyUI** | Results in `staging/` | Accepting a result replaces the source with no backup; see [ComfyUI](comfyui.md#review-candidates) |
| **Quick LoRA training** | Nothing in the folder | Starts and monitors a run in [AI-Toolkit](ai-toolkit.md) |

Jobs that change captions run once per caption, so `scene.jpg` and `scene.png` sharing `scene.txt` are changed once, and the result names both.

## Settings

Open **Settings** from the folder sidebar or with `Ctrl+,`. It covers appearance, model connections and input budgets, integration URLs, tagging, cache limits, and history retention. **Save** applies field changes, and **Reset** then **Save** returns a field to its environment or default value. **Clear** actions apply immediately, even if you cancel. See [Configuration](configuration.md) for models, every variable, and troubleshooting.

## Supported formats

Every format below shows in the gallery and takes a `.txt` caption. AI caption jobs and ComfyUI accept images and videos; jobs skip audio, which you caption by hand. Whether a workflow or training model handles a file depends on that model, not on the gallery.

| Format | Gallery | Editor | Strip metadata | Watermark | ComfyUI workflow shown |
| --- | --- | --- | --- | --- | --- |
| JPG/JPEG, WebP | Image | Image | Yes | Yes | — |
| PNG | Image | Image | Yes | Yes | Yes |
| BMP | Image | Image | Nothing to strip | Yes | — |
| GIF | Animation, frame capture | Convert to MP4 first | — | Yes | — |
| MP4, MOV, M4V | Playback and frame capture if the browser has the codec | Video | Yes | Yes | Yes |
| AVI, MKV, WMV, FLV | Thumbnail only | — | — | — | — |
| WAV, MP3, FLAC | Waveform and playback | Audio | — | — | — |

Auto-adjust covers the image and video editor formats. Caption jobs use a GIF's first frame and sample frames across a video, including containers the browser cannot play. A watermarked GIF stays an animated GIF with its frame timing, loop count, and transparency.

## Files DataForge creates

`<stem>` is the name without its extension (`scene`); `<name>` includes it (`scene.jpg`). Related files travel with their media but are not gallery items. Media in `watermarked/` and `staging/` can be browsed like any folder.

Files with the same stem, such as `scene.jpg` and `scene.png`, share one caption. Edit originals and settings belong to each file. Use different stems when files need different captions.

| File | Where | Made by | Removed when |
| --- | --- | --- | --- |
| `<stem>.txt` | Beside media | You or a caption job | You delete it or its media |
| `.sysprompt`, `.captionrules` | Dataset or a parent folder | Folder instructions | You save that tab empty |
| `<name>.issue.json` | Beside media | Verify or Lint captions | Findings are resolved or cleared |
| `<name>.duplicate.json` | Beside media | Find duplicates | The group is resolved, dismissed, or cleared |
| `<name>.bak`, `<name>.edit.json` | Beside media | The editor or Auto-adjust: original and edit settings | **Revert original**, or accepting a ComfyUI result |
| `<stem>-edit.video-project.json` | Beside the first video | Video editor draft | **Delete project**; its media and exports stay |
| `<name>.video-project.json` | Beside an exported video | The edit that export came from | It moves, copies, and deletes with the video |
| `<stem>.txt` | `.backup/` | Caption backup | You delete it; restoring keeps it |
| Watermarked media | `watermarked/` | Watermark | You delete it |
| Result, `<result-name>.comfy.json` | `staging/` | Process with ComfyUI | It is accepted, rejected, or deleted |
| Database, thumbnails | `backend/data/` | The app: settings, jobs, notifications, tags | Pruned by [retention](configuration.md#server-storage-and-logging) |
| `watermark.png` | `backend/data/` | The PNG chosen in the Watermark dialog | Choosing another PNG replaces it |
| `tag_vocabulary.txt` | `backend/data/` | You: extra tag terms | You delete it |
| Tagging model | `backend/data/models/` | The first tagging run; `DATAFORGE_MODELS_DIR` moves it | You delete it |

For example, `scene.jpg` can have `scene.txt`, `scene.jpg.issue.json`, `scene.jpg.duplicate.json`, `scene.jpg.bak`, and `scene.jpg.edit.json`.

The gallery hides `.backup/` and common repository, environment, system, and cache folders, such as `.git`, `node_modules`, `.venv`, `__pycache__`, `_latent_cache`, and `_t_e_cache`.

## Keyboard shortcuts

Press `?` outside a text field to see the shortcut list in the app. On macOS, use `⌘` for `Ctrl` and `⌥` for `Alt`; caption completion stays `Ctrl+Space`.

### Global and folders

| Shortcut | Action |
| --- | --- |
| `Ctrl+P` | Open or close **Quick actions**; then `↑` `↓` `Home` `End` choose and `Enter` runs |
| `Ctrl+F` or `/` | Focus search |
| `Ctrl+,` | Open Settings |
| `?` | Show keyboard shortcuts |
| `Alt+↑` | Go to the parent folder |
| `Alt+Home` | Go to the home folder |
| `Alt+N` | Create a folder |
| `Enter` / `Escape` | Confirm / close a dialog or viewer |

### Gallery and selection

| Shortcut | Action |
| --- | --- |
| `Ctrl+click` | Toggle a file and enter selection mode |
| `Shift+click` | Select the range from the anchor to the clicked file |
| `Ctrl+A` | Select every file shown |
| `Delete` or `Backspace` | Delete the selected files, after confirmation |
| `Escape` | Clear the selection; press again to leave selection mode |

### Inspector and review

| Shortcut | Action |
| --- | --- |
| `←` / `→`, `Home` / `End` | Previous / next, first / last file |
| `Ctrl+Enter` | Inspector: save and go to the next file. Issue resolver: mark resolved. Candidate review: accept |
| `Ctrl+Backspace` | Candidate review: reject |
| `Delete` or `Backspace` | Inspector: delete the file, after confirmation |

### Editors

| Shortcut | Action |
| --- | --- |
| `Ctrl+F` | Find in the focused text editor |
| `Ctrl+Space` | Show caption word completions; `Escape` closes them first |
| Arrow keys | Nudge a focused crop, mask, or trim handle, or Adjust slider; `Shift` for larger steps |
| `Delete` | Remove the focused mask |
| `Home` / `End` | Move a video trim handle to the start / end |

A video trim handle moves one frame per arrow press, or one second with Shift. For the video editor, see its [shortcuts](video-editor.md#keyboard-shortcuts).

### Focus

Shortcuts depend on focus. Text fields keep their own keys, and plain-key shortcuts are ignored while typing. Focused video controls use the arrow keys to seek. Enter does not confirm from a multi-line field, and busy dialogs block actions that would interrupt them. `Escape` closes a menu or overlay before the dialog around it.
