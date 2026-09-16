# User guide

[DataForge documentation](README.md)

DataForge treats a dataset as a folder of media plus files stored beside that media. It does not import a dataset into a proprietary library or require a cloud account.

## The dataset model

A caption is a `.txt` file with the same stem as its media. For example, `scene.jpg` uses `scene.txt`. DataForge reads and writes those files in place.

A folder can also contain `.sysprompt`, a Markdown system prompt used by AI captioning. Create or edit it from the automation panel. **Auto-caption** stays disabled until the file exists and contains instructions.

The app scans supported media in the current folder, not recursively. It ignores its own backups and common development/cache folders. Files added, changed, or removed outside DataForge appear in the gallery without a full browser refresh.

## Browse and organize

Open a drive or folder from the folder picker. Breadcrumbs move through parent folders; you can copy the current path and, on Windows, open it in File Explorer. DataForge remembers recent folders and favorites.

### Search, filters, sorting, and display modes

Search file names, folder names, and captions. Use the regex option when you need a regular expression. `Ctrl+K` on Windows/Linux or `⌘K` on macOS focuses search.

Use the filter menu to combine:

- Media type: images, or videos and GIFs.
- Caption status: captioned, missing, or with caption issues.
- File state: edited media, duplicate findings, or ComfyUI candidates.

Every filter is also a quick action, so you can narrow the view without opening the menu. **Reset all filters** returns all three axes to *All*; it leaves the search box alone, which has its own clear button.

The gallery has large cards, small cards, and a list view. Sorting supports name, modified date, caption length, megapixels, and video duration in either direction. The display mode is remembered for each folder; sort choice is a server-side preference.

### Select, copy, move, rename, and delete

Use **Select** or `Ctrl+A`/`⌘A` to enter selection mode and select every visible media item. Search and filters change what “visible” means; they do not implicitly narrow a job unless you select the resulting files.

Selection mode can invert or clear the visible selection, then copy, move, or delete the selected files. `Delete` (or `Backspace`) opens the same delete confirmation the toolbar button does. **Rename** gives media a numbered name and moves related sidecars with it. Creating a subfolder and drag-and-drop import are available from the folder view.

Move, copy, rename, and delete carry normal media sidecars, duplicate/issue findings, stored edit originals/specifications, the `.backup/` caption, and any staged ComfyUI candidate with the source. Rename is refused while a file is still rendering an edit or being accepted.

On Windows, media deletion uses the Recycle Bin. On other platforms, DataForge shows the names before deletion; confirm only when the list is correct.

## Captions and instructions

Open a media item to edit its caption. DataForge saves trimmed text to the matching `.txt` sidecar and updates the item’s caption state. Card badges and the detail view distinguish missing captions, empty caption files, text, issues, duplicates, candidates, and edited media.

### Edit captions and `.sysprompt`

Captions autosave and show failures with a **Retry** button. **Revert** restores the caption as it was when opened, and **Restore backup** loads its `.backup/` copy when one exists. The editor completes from the folder's caption vocabulary; type two characters or press `Ctrl+Space`/`⌘Space` to show suggestions.

Use a `.sysprompt` to set the voice, required details, or output format for AI captioning in one folder. It is Markdown text stored alongside the dataset and can travel with it. Unlike captions, the system prompt does not autosave: edit it, then **Save**. **Reset** restores the text as it was when you opened it, and closing with unsaved edits asks before discarding them.

The caption editor, the issue resolver, and the `.sysprompt` editor each report the estimated tokens. The token figure is prefixed with `~` because it is an approximation from text length, not a real tokenizer count.

**Set captions** writes one caption to many files. **Find & replace** changes literal or regex matches, or prepends/appends text; its dialog previews the affected count and before/after examples. **Edit captions** sends existing caption text and your instruction to the configured model, not the source media. Back up captions before a destructive rewrite when you may need to undo it.

### Verify and resolve issues

**Verify captions** compares the current caption with an image, GIF still, or video keyframes. It writes `.issue.json` only when it finds a problem and leaves other findings in the folder intact.

Use **Resolve issues** to step through flagged files. Edit the caption, resolve it, or move through the queue. `Ctrl+Enter`/`⌘Enter` resolves the current issue; left/right arrows move through the queue when focus is not in an editor. The resolver opens images in the system preview on Windows and supports zoom for still media.

You can remove every `.issue.json` file from the current folder through the quick action bar. That clears findings only; it never deletes captions or media.

### Find and resolve duplicates

**Find duplicates** uses perceptual matching with exact, near, and loose thresholds. It writes `.duplicate.json` findings, and the duplicate filter exposes their media.

The duplicate resolver shows each group side by side and recommends a keeper, usually the highest-resolution candidate. Choose the keeper and delete the rest, or dismiss the group to clear its finding without deleting any media. You can also remove every `.duplicate.json` finding through the quick action bar.

### Back up and restore captions

**Backup captions** copies `.txt` sidecars to the current folder’s `.backup/` directory. It does not copy `.issue.json` findings. Existing backup files stay unchanged unless you explicitly choose overwrite.

**Restore captions** copies backed-up `.txt` files over captions in the current folder. It skips backup files whose matching media no longer exists. The restore confirmation is intentional: it overwrites current captions. Backup and restore can use an active selection; without one, they use the whole folder.

## Edit media

DataForge writes media edits from an original backup instead of repeatedly encoding the previously edited result. A later change rerenders from the stored original, and **Revert original** restores it.

### Image editing

JPG, JPEG, PNG, WebP, and BMP files can be cropped to preset aspect ratios, rotated in quarter turns, mirrored horizontally or vertically, resized by scale or target dimensions, and adjusted for brightness, contrast, saturation, warmth, and hue.

Add rectangular blur, pixelate, or blackout regions when an image needs redaction. Apply all current changes in one pass. Image edits store `<name>.<ext>.bak` and `<name>.<ext>.edit.json` beside the source, hidden from the gallery.

### Video editing

MP4, MOV, and M4V files can be trimmed, cropped, resized, sped up or slowed down, muted or volume-adjusted, color-adjusted, and redacted with blur, pixelate, or blackout regions. The timeline supports playhead trim points and arrow-key nudging of its handles.

Rendering happens in one pass from `<name>.<ext>.bak`. The detail view shows render progress and allows cancellation while the rendering process is active. Revert restores the original and removes the stored edit state.

### GIF and frame tools

GIFs keep their animation during normal browsing. Convert a GIF to MP4 at DataForge’s fixed 24 fps when you need a video file. If an MP4 target with the same stem already exists, DataForge asks before overwriting it.

For a playable video or GIF, **Save a frame as JPG** writes a new image beside the source. Video names include a timestamp; GIF names include the frame index. GIF frame capture does not re-encode the animation.

## Automation jobs

### Job scope, progress, cancellation, and history

Jobs run in the background. The automation panel and jobs drawer show progress, warnings, cancellation, history, and, where available, samples from external training jobs.

A selected set of files narrows most jobs. Without a selection, a job runs against the entire current folder. **Quick LoRA training** is the exception: AI-Toolkit trains from the whole folder even if you selected files. Filters help locate files but do not become job scope automatically.

Finished jobs list each file's result. **Retry N failed** reopens the job scoped to failed files, while **Run again** opens it for the whole folder.

A new job of the same type for a folder replaces the previous local job record for that type. Cancel only stops the current run; outputs already written by an operation remain on disk.

### Job reference

| Job                      | What it does                                                                              | Files and reversibility                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto-caption**         | Completes short drafts through an OpenAI-compatible vision model; can include video audio | Writes `.txt` captions. Requires a nonempty `.sysprompt` and configured model. Existing long captions are skipped according to `DRAFT_CAPTION_THRESHOLD`. |
| **Set captions**         | Writes the same text to each target                                                       | Overwrites `.txt` captions only when the dialog’s overwrite choice permits it.                                                                            |
| **Find & replace**       | Replaces literal/regex text, or prepends/appends text                                     | Rewrites matching captions. Preview before confirming.                                                                                                    |
| **Edit captions**        | Rewrites existing captions from an instruction                                            | Sends text, not media, to the model. Optional backup copies `.txt` files to `.backup/`.                                                                   |
| **Verify captions**      | Checks captions against media                                                             | Writes or updates `.issue.json` findings; does not rewrite captions.                                                                                      |
| **Find duplicates**      | Groups perceptual matches                                                                 | Writes `.duplicate.json` findings. Review deletes media only after confirmation.                                                                          |
| **Quick LoRA training**  | Creates and starts an AI-Toolkit training job                                             | Uses the entire current folder and `.txt` captions. See [AI-Toolkit](ai-toolkit.md).                                                                      |
| **Rename**               | Renames media in sequence                                                                 | Carries related sidecars. This has no automatic undo.                                                                                                     |
| **Watermark**            | Burns text into image/video copies                                                        | Writes copies to `watermarked/`, without caption sidecars. Optionally strips their metadata.                                                              |
| **Process with ComfyUI** | Runs images, GIFs, or video through a ComfyUI preset                                      | Stages candidates in `staging/` in whatever format the graph produced; **Review candidates** decides whether to publish each one. See [ComfyUI](comfyui.md). |
| **Strip metadata**       | Removes embedded provenance metadata                                                       | Rewrites supported media in place without altering caption sidecars. Removes provenance only (EXIF, text/workflow chunks, container tags); the colour profile, colour and density chunks, and every stream are kept. |
| **Backup captions**      | Copies `.txt` captions to `.backup/`                                                      | Existing backup files are kept unless overwrite is selected.                                                                                              |
| **Restore captions**     | Restores `.txt` captions from `.backup/`                                                  | Overwrites current captions for media that still exists; never restores issue findings.                                                                   |

## Dataset statistics

The statistics drawer always describes the whole current folder, not the filtered gallery. It shows caption coverage; missing captions; caption issues; duplicate files and groups; shortest, median, and longest caption lengths; frequent words; media extensions; video duration; megapixel and aspect-ratio distributions; and files whose resolution or duration could not be read.

## Supported formats and capability matrix

All listed formats appear in the gallery, receive thumbnails, support `.txt` captions, and can participate in Quick LoRA training. Actual browser playback depends on the local browser’s decoder support; DataForge’s editing and metadata tools intentionally use narrower sets.

| Format                | Playback / frame capture                                           | Edit              | Strip metadata                       | Watermark | Inspect embedded ComfyUI workflow | Process with ComfyUI |
| --------------------- | ------------------------------------------------------------------ | ----------------- | ------------------------------------ | --------- | --------------------------------- | -------------------- |
| JPG / JPEG            | Still image                                                        | Image tools       | Yes                                  | Yes       | No                                | Yes                  |
| PNG                   | Still image                                                        | Image tools       | Yes                                  | Yes       | Yes                               | Yes                  |
| WebP                  | Still image                                                        | Image tools       | Yes                                  | Yes       | No                                | Yes                  |
| BMP                   | Still image                                                        | Image tools       | No-op; BMP has no metadata container | Yes       | No                                | Yes                  |
| GIF                   | Frame capture; convert to MP4                                      | No animation edit | No                                   | No        | No                                | Yes                  |
| MP4 / MOV / M4V       | Video playback and frame capture                                   | Video tools       | Yes                                  | Yes       | Yes                               | Yes                  |
| AVI / MKV / WMV / FLV | Listed and captioned; browser playback is not supported by the app | No                | No                                   | No        | No                                | Yes                  |

**Process with ComfyUI** sends every listed format and lets the workflow decide: a file the graph's loader cannot read fails with ComfyUI's own message and the run carries on. A candidate can be staged as PNG, MP4, MOV, or GIF. Watermarking, video editing, metadata stripping, and embedded workflow inspection use MP4/MOV/M4V for video because those containers can be read and remuxed safely here.

**Strip metadata** removes provenance only. For images it deletes EXIF, XMP, and text chunks (including any embedded ComfyUI workflow) but preserves the ICC colour profile and the colour and density chunks, so the picture renders identically. For video it drops container tags and chapters and remuxes without re-encoding, keeping every audio and video stream. The same guarantees apply to the optional strip step in the **Watermark** job.

## Files DataForge creates

| Item                            | Location and lifecycle                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Caption                         | `<stem>.txt` beside media; standard dataset sidecar                                                                           |
| AI instructions                 | `.sysprompt` in the dataset folder                                                                                            |
| Caption finding                 | `<stem>.issue.json` beside media; created by verification and cleared when resolved/swept                                     |
| Duplicate finding               | `<stem>.duplicate.json` beside media; created by duplicate detection and cleared when dismissed/swept                         |
| Edit original and specification | `<name>.<ext>.bak` and `<name>.<ext>.edit.json` beside edited media; carried by normal media operations and removed by revert |
| Caption backup                  | `.backup/<stem>.txt`; created by **Backup captions**                                                                          |
| Watermark copy                  | `watermarked/`; generated output without caption sidecars                                                                     |
| ComfyUI candidate               | `staging/<stem>.png` plus `.comfy.json`; stays staged until accepted or rejected                                              |
| App state and thumbnails        | `backend/data/` by default; gitignored SQLite state and cache                                                                 |

A move, copy, rename, or delete in DataForge takes a staged candidate along. Changes made outside DataForge leave it orphaned; the review queue can discard it. Accepting a candidate is final and is refused while the source has an unreverted media edit.

## Keyboard shortcuts

| Shortcut                           | Where it works                                | Action                                                          |
| ---------------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| `Ctrl+K` / `⌘K`                    | Gallery                                       | Focus search                                                    |
| `Ctrl+Space` / `⌘Space`            | App                                           | Open the quick action bar                                       |
| `Ctrl+A` / `⌘A`                    | Gallery, outside text inputs/dialogs          | Enter selection mode and select every visible file              |
| `Delete` / `Backspace`             | Selection mode, outside text inputs/dialogs   | Open the delete confirmation for the selected files             |
| `Escape`                           | Selection mode                                | Clear selected files first; press again to leave selection mode |
| `←` / `→`                          | Item detail, candidate review, issue resolver | Previous or next item when focus is not editable                |
| `Ctrl+Enter` / `⌘Enter`            | Issue resolver                                | Resolve the current issue                                       |
| `Ctrl+Enter` / `⌘Enter`            | Candidate review                              | Accept the current candidate when acceptance is available       |
| `Enter`                            | Any dialog with a confirm button              | Confirm the dialog; ignored in multi-line fields and while busy |
| `Escape`                           | Any dialog or overlay                         | Close it, unless a job in that dialog is still running          |
| `↑` / `↓`, `Home` / `End`, `Enter` | Quick action bar                              | Move through results and run the highlighted action             |
| `←` / `→` / `↑` / `↓`              | Video timeline trim handle                    | Nudge the handle one frame; hold `Shift` for one-second steps   |
| `Home` / `End`                     | Video timeline trim handle                    | Jump the handle to the start or the end of the clip             |
| `Ctrl+Space` / `⌘Space`            | Caption editor                                | Ask for caption completions from the folder’s vocabulary        |
| `Escape`                           | Caption editor with completions open          | Dismiss the completion list without closing the dialog          |

Except where the table says otherwise, shortcuts do not override focused text inputs, an open dialog, a busy operation, or media controls that need the same keys.

## Related guides

- [Getting started](getting-started.md)
- [Configuration](configuration.md)
- [Process images with ComfyUI](comfyui.md)
- [Train LoRAs with AI-Toolkit](ai-toolkit.md)
- [Development](development.md)
