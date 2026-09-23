# User guide

[Documentation](README.md)

A dataset in DataForge is just a folder. `scene.jpg` is captioned by `scene.txt` beside it, and DataForge reads and writes those files in place. A folder can also hold a `.sysprompt`: Markdown instructions that tell the AI how to caption that folder, which travel with the dataset.

DataForge shows the media in the open folder only, not in subfolders, and skips its own backup folder and common development and cache folders. Files added, changed, or removed outside the app appear without a refresh.

## Browse and organize

Open a folder or drive from the folder picker. Breadcrumbs, recent folders, and favorites get you around. You can copy the current path, and on Windows open it in File Explorer.

- **Search** matches file names, folder names, and captions, with an optional regex mode (`Ctrl+K`).
- **Filters** narrow by media type (images, or videos and GIFs), caption state (captioned, missing, with issues), and file state (edited, duplicates, ComfyUI results). Each filter is also in the quick action bar. **Reset all filters** clears the filters but not the search.
- **Sort** by name, modified date, caption length, megapixels, or duration, in either direction. The sort is remembered across sessions.
- **View** as large cards, small cards, or a list. Each folder remembers its view.

Cards and the detail view show whether a file has no caption, an empty caption, or text, and whether it has an issue, a duplicate finding, a ComfyUI result, or an edit.

### Select, copy, move, rename, delete

**Select** (or `Ctrl+A`) selects every file the current search and filters show. From there you can invert, clear, copy, move, or delete (`Delete`). **Rename** gives files sequential numbered names; it is refused for a file whose edit is still rendering or whose ComfyUI result is being accepted. You can also create subfolders and drag files in to import them.

Every file operation carries the related files along with the media: caption, findings, edit original, caption backup, and any staged ComfyUI result. Deleting goes to the Recycle Bin on Windows. On other platforms the confirmation lists every file first, and the delete is permanent.

## Captions

Open a file to edit its caption. Captions **autosave**, trimmed of surrounding whitespace, and a failed save shows **Retry**. **Revert** returns to the text you opened with, and **Restore backup** loads the copy in `.backup/`. Type two characters, or press `Ctrl+Space`, to get completions from words already used in the folder.

Create or edit the folder's `.sysprompt` from the automation panel. Use it to set the voice, required details, or format of AI captions. Unlike captions, it does not autosave: **Save** writes it, **Reset** discards your changes, and closing with unsaved changes asks first. **Auto-caption** stays disabled until the folder has a non-empty `.sysprompt`.

The caption, issue, and `.sysprompt` editors show an approximate token count (`~`), estimated from text length rather than a real tokenizer.

### Caption issues

**Verify captions** has the model compare each caption with the image, the GIF's first frame, or the video's keyframes. It writes a `.issue.json` beside each file it flags and leaves other findings alone.

**Resolve caption issues** steps through the flagged files. Fix the caption, mark it resolved (`Ctrl+Enter`), and move on with the arrow keys. Still images can be zoomed, and on Windows opened in the system viewer. **Delete all .issue.json files** in the quick action bar clears every finding in the folder without touching captions or media.

### Duplicates

**Find duplicates** groups visually similar files by perceptual hash, with exact, near, or loose matching, and writes `.duplicate.json` findings. The resolver shows each group side by side and suggests a keeper, usually the one with the highest resolution. Keep one and delete the rest, or dismiss the group to keep them all. **Delete all .duplicate.json files** clears every finding at once without deleting media.

### Caption backups

**Backup captions** copies `.txt` files into `.backup/` and keeps existing backups unless you choose to overwrite them. **Restore captions** copies them back, overwriting current captions, which is why it asks first. It skips backups whose media no longer exists. Neither job touches `.issue.json` findings. Back up before any bulk rewrite you might want to undo.

## Edit media

Every edit is rendered in one pass from the original, which is kept beside the file as `<name>.bak` together with the edit settings in `<name>.edit.json`. Changing an edit later never re-encodes an already-edited copy, and **Revert original** restores the original and removes both files.

- **Images** (JPG, PNG, WebP, BMP): crop to preset ratios, rotate in quarter turns, mirror, resize by scale or to exact dimensions, and adjust brightness, contrast, saturation, warmth, and hue.
- **Videos** (MP4, MOV, M4V): trim on the timeline, crop, resize, change speed or volume or mute, and apply the same color controls. Rendering shows progress and can be cancelled.
- **Both**: add any number of blur, pixelate, or blackout regions to hide parts of the frame.
- **Frames**: **Save frame as JPG** writes the current frame of a video or GIF beside the source. Names include the video timestamp or the GIF frame number, and the source is not re-encoded.
- **GIF to MP4**: converts a GIF at 24 fps, and asks before overwriting an MP4 of the same name.

## Jobs

Jobs run in the background. The automation panel and jobs drawer show progress, warnings, cancellation, history, and per-file results. **Retry N failed** reruns only the failures, and **Run again** reruns on the whole folder.

**Scope:** if files are selected, a job runs on those. Otherwise it runs on the whole folder. Filters alone don't narrow a job; select the filtered files if that's what you want. **Quick LoRA training** always uses the whole folder.

Cancelling stops the run but keeps whatever it already wrote. Starting a job replaces the history entry of the previous job of that type in the same folder.

| Job                      | What it does                                                         | What it writes                                                                         |
| ------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Auto-caption**         | Captions media with a vision model, optionally hearing the video's audio | `.txt`. Needs a `.sysprompt` and a [model](configuration.md#connect-a-vision-model); skips captions already longer than [the threshold](configuration.md#vision-model-settings) |
| **Verify captions**      | Checks each caption against its media                                | `.issue.json` for problems; captions are untouched                                     |
| **Edit captions**        | Rewrites captions from an instruction; the model sees text, not media | `.txt`, backing up to `.backup/` first unless you opt out                              |
| **Set captions**         | Writes the same text to every file                                   | `.txt`; overwrites existing captions only if you allow it                              |
| **Find & replace**       | Replaces text or regex matches, or adds text at the start or end     | `.txt`; the dialog previews the count and examples first                               |
| **Find duplicates**      | Groups visually similar files                                        | `.duplicate.json`; media is deleted only when you confirm it in the resolver           |
| **Backup captions**      | Copies captions to `.backup/`                                        | `.backup/*.txt`                                                                        |
| **Restore captions**     | Copies captions back from `.backup/`                                 | Overwrites `.txt`                                                                      |
| **Rename**               | Renames files in sequence                                            | Renames media and its related files; no undo                                           |
| **Watermark**            | Stamps text onto copies, optionally stripping their metadata          | Copies in `watermarked/`, without captions                                             |
| **Strip metadata**       | Removes provenance metadata; see below                               | Rewrites media in place; captions are untouched                                        |
| **Process with ComfyUI** | Runs media through a workflow                                        | Results in `staging/` for review; see [ComfyUI](comfyui.md)                            |
| **Quick LoRA training**  | Starts an AI-Toolkit training run                                    | Nothing in the folder; see [AI-Toolkit](ai-toolkit.md)                                 |

**Strip metadata**, and the same option in **Watermark**, never changes how a file looks or sounds. On images it removes EXIF, XMP, and text chunks, including embedded ComfyUI workflows, and keeps the color profile and color and density information. On videos it removes container tags and chapters and remuxes without re-encoding, keeping every audio and video stream.

The **statistics** drawer always describes the whole folder, whatever the filters show. It covers caption coverage, missing captions, issues, duplicate files and groups, shortest, median, and longest captions, frequent words, file types, video durations, megapixel and aspect-ratio distributions, and files whose size or duration couldn't be read.

## Supported formats

Every format below appears in the gallery with a thumbnail, takes `.txt` captions, and can be used for training and ComfyUI processing. Editing and metadata tools support fewer video containers, only those DataForge can read and rewrite safely.

| Format                | In the app                          | Editing        | Strip metadata   | Watermark | Embedded ComfyUI workflow |
| --------------------- | ----------------------------------- | -------------- | ---------------- | --------- | ------------------------- |
| JPG / JPEG, WebP      | Image                               | Image          | Yes              | Yes       | —                         |
| PNG                   | Image                               | Image          | Yes              | Yes       | Yes                       |
| BMP                   | Image                               | Image          | Nothing to strip | Yes       | —                         |
| GIF                   | Animated; frame capture             | Convert to MP4 | —                | —         | —                         |
| MP4, MOV, M4V         | Playback, if your browser supports the codec; frame capture | Video | Yes  | Yes       | Yes                       |
| AVI, MKV, WMV, FLV    | Thumbnail only, no playback         | —              | —                | —         | —                         |

## Files DataForge creates

| File                                  | Where                  | Created by                    | Removed when                          |
| ------------------------------------- | ---------------------- | ----------------------------- | ------------------------------------- |
| `<stem>.txt`                          | Beside the media       | You, or any caption job       | You delete it                         |
| `.sysprompt`                          | Dataset folder         | You                           | You delete it                         |
| `<name>.issue.json`                   | Beside the media       | **Verify captions**           | Resolved or cleared                   |
| `<name>.duplicate.json`               | Beside the media       | **Find duplicates**           | Group resolved, dismissed, or cleared |
| `<name>.bak`, `<name>.edit.json`      | Beside the media       | A media edit                  | **Revert original**                   |
| `<stem>.txt`                          | `.backup/`             | **Backup captions**           | You delete it                         |
| Watermarked copies                    | `watermarked/`         | **Watermark**                 | You delete them                       |
| ComfyUI result and its `.comfy.json`  | `staging/`             | **Process with ComfyUI**      | Accepted or rejected                  |
| Settings, job history, thumbnails     | `backend/data/`        | The app                       | —                                     |

`<stem>` is the file name without its extension (`scene`), and `<name>` is the full file name (`scene.jpg`), as in `scene.jpg.issue.json`. None of these appear as items in the gallery. Moving, copying, renaming, or deleting media in DataForge carries these files along. Changes made outside DataForge leave them behind; see [ComfyUI](comfyui.md#review-candidates) for orphaned results.

## Keyboard shortcuts

On macOS, use `⌘` instead of `Ctrl`. Plain-key shortcuts such as arrows and `Delete` are ignored while you type in a text field, while a dialog is busy, and when media controls need the same keys.

| Shortcut                     | Where                                      | Action                                                   |
| ---------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `Ctrl+K`                     | Gallery                                    | Focus search                                             |
| `Ctrl+Space`                 | Anywhere                                   | Open the quick action bar                                |
| `↑` `↓` `Home` `End` `Enter` | Quick action bar                           | Move through actions and run one                         |
| `Ctrl+A`                     | Gallery                                    | Select every visible file                                |
| `Delete` / `Backspace`       | With files selected                        | Delete the selection (asks first)                        |
| `Escape`                     | Selection mode                             | Clear the selection; press again to leave selection mode |
| `←` / `→`                    | Detail view, issue resolver, result review | Previous / next file                                     |
| `Ctrl+Enter`                 | Issue resolver                             | Mark resolved                                            |
| `Ctrl+Enter`                 | Result review                              | Accept the result                                        |
| `Ctrl+Space`                 | Caption editor                             | Show word completions                                    |
| `Escape`                     | Caption editor with completions open       | Close the completions only                               |
| `Enter`                      | Dialogs                                    | Confirm; ignored in multi-line fields and while busy     |
| `Escape`                     | Dialogs and overlays                       | Close, unless a job in that dialog is still running      |
| `←` `→` `↑` `↓`              | Video trim handle                          | Move one frame; hold `Shift` for one second              |
| `Home` / `End`               | Video trim handle                          | Jump to the start / end                                  |
