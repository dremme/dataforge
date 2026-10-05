# User guide

[Documentation](README.md)

A dataset is a folder: `scene.jpg` uses `scene.txt` beside it. DataForge reads and writes those files directly. The gallery shows the open folder's media, not its subfolders, and updates when files change outside the app.

## Browse and organize

Open a folder with the folder picker (`Ctrl+O`). Breadcrumbs, recent folders, and favorites help you navigate. You can copy the current path and, on Windows, open it in File Explorer.

- **Search** (`Ctrl+F` or `/`) matches file names, folder names, and captions. Enable regex to use regular expressions.
- **Filters** narrow by media type, caption state, issues, edits, duplicates, or ComfyUI results. **Reset all filters** keeps your search text.
- **Sort** by name, modification date, caption length, megapixels, or duration, in either direction. The sort is remembered across sessions.
- **View** as large cards, small cards, or a list. Each folder remembers its view.

Cards and the detail view distinguish missing, empty, and populated captions, and show badges for findings, candidates, and edits. The **statistics** drawer describes the whole folder, regardless of filters: caption coverage and lengths, frequent words, issues, duplicate groups, formats, durations, megapixels, aspect ratios, and unreadable dimensions/durations.

Folder cards show caption coverage; hover over one to see its caption issue and staged candidate counts. Click the toolbar's captioned or issue count to filter those files; click it again to clear that filter. The automation panel's **Ready to review** buttons open caption issues, duplicate groups, and ComfyUI candidates.

Videos start muted and loop in the viewer and review queues. In the video editor, playback loops within the selected trim range.

Press `Ctrl+P` for **Quick actions**: search for jobs, commands, filters, and folders, then select an action and press Enter. Press `?` to see the shortcut list in the app.

### Select, copy, move, rename, delete

**Select** or `Ctrl+A` selects every media file shown by the current search and filters. `Ctrl+click` toggles one file. In selection mode you can invert or clear the selection, copy, move, or delete it. Copy and move preview conflicts and ask before overwriting destination files.

**Rename** assigns sequential numbered names and has no undo. Files being rendered or having a ComfyUI result accepted cannot be renamed. You can also create subfolders and drag supported media and `.txt` captions into the app to import them.

File operations in DataForge carry captions, findings, edit originals, caption backups, and staged ComfyUI results with their media. Folder instructions stay with the folder. On Windows, deletion uses the Recycle Bin; on other platforms it is permanent after confirmation.

Drag-and-drop imports accept only the media and `.txt` files you choose; they do not collect other related files automatically. Transfers attempt to restore previous destination files if an overwrite fails. Check reported failures before deleting source copies.

## Captions

Open a file and edit its caption. Captions **autosave**, with surrounding whitespace trimmed; a failed save shows **Retry**. **Revert** restores the text you opened with. **Restore backup** loads its saved caption from `.backup/`.

Type two characters or press `Ctrl+Space` for word completions from the folder's captions. `Ctrl+Enter` saves and moves to the next item. The token count marked `~` is an estimate from text length, not a model tokenizer.

### Folder instructions

Choose **Create instructions** or **Edit instructions** in the automation panel:

- **System prompt** sets the voice, required details, or format for Auto-caption, in `.sysprompt`. Auto-caption requires instructions in this folder or an ancestor.
- **Caption rules** defines checks for **Lint captions**, in `.captionrules`. Use **Use template** to start when no rules apply.

Each file applies to descendants without their own file. The editor identifies inherited instructions; **Copy from parent** makes a local copy. **Save** writes changed tabs to the current folder, and **Reset** discards the open tab's changes. These tabs do not autosave; closing with unsaved changes asks first.

The two files inherit independently from the nearest ancestor and replace its contents as a whole; they are never merged. Saving a tab empty removes its local file so inheritance resumes. An empty file created outside the app still blocks inheritance. Invalid inherited rules are reported rather than skipped.

### Caption issues

1. Run **Verify captions** for a model check against the media, or **Lint captions** for a local rule check.
2. Open **Resolve caption issues** to step through findings.
3. Correct the caption, mark it resolved (`Ctrl+Enter`), and continue with the arrow keys.

Both checks write `.issue.json` findings and leave captions unchanged. Model and rule findings are kept separately; rerunning one check replaces only its findings. Still images can be zoomed and, on Windows, opened in the system viewer. **Delete all .issue.json files** in Quick actions clears findings without changing captions or media.

### Caption rules

Linting needs no model. Edit the rules in the folder-instructions dialog, run **Lint captions**, then use **With issues** or the resolver to inspect hits. Try the rules supplied in [`sample_images/`](../sample_images/).

Example `.captionrules`:

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

All settings are optional, but at least one active rule is required. The file must contain YAML key/value pairs as shown above. Unknown keys are rejected, including keys inside `words` and `flag` entries.

| Setting                   | Accepted value                                   | Check                                                                                                           |
| ------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `trigger`                 | Nonempty text                                    | Caption must start with this term or phrase, case-sensitive and at a word boundary                              |
| `words.min` / `words.max` | Integers ≥ 1; at least one bound, with min ≤ max | Inclusive limits on whitespace-separated words                                                                  |
| `repeated_phrases`        | Integer ≥ 2                                      | Flags non-overlapping repeated phrases of at least this many words, ignoring case and punctuation between words |
| `flag`                    | List of rule mappings                            | Each entry contains `match` and optional `note`                                                                 |
| `flag[].match`            | One term or a nonempty list of terms             | Case-insensitive whole-word or phrase matches; any listed term can produce a finding                            |
| `flag[].note`             | Optional text                                    | Explanation included in that rule's finding                                                                     |

Terms are literal text, not regular expressions. A trailing `*` also matches a word suffix: `float*` catches `floating`. Phrases match across whitespace, including line breaks. A `match` term must contain text besides the wildcard. Repeated-phrase checks treat contractions as words and count repeated occurrences without overlap.

Lint captions skips missing caption files; an existing empty caption is checked. Each media file keeps at most five rule findings. If there are more, the fifth summarizes the remaining hits.

### Duplicates

**Find duplicates** groups visually similar files using perceptual hashes (compact representations of appearance), with exact, near, or loose matching. The resolver compares each group and suggests a keeper, usually the highest-resolution file. Keep one and delete the others, or dismiss the group to keep them all. **Delete all .duplicate.json files** clears findings without deleting media.

### Caption backups

Back up before a bulk rewrite you may want to undo. **Backup captions** copies `.txt` files into `.backup/`, keeping existing backups unless overwrite is enabled. **Restore captions** asks before overwriting current captions, skips files whose media is gone, and keeps the backup files. Neither job changes issue findings.

In **Edit captions**, enter an instruction and click **Dry run** in the dialog actions to test it before
starting the job. The preview uses up to three readable captions in filename order from the
current folder or selection, with the same model settings as the job. It highlights removed and
added text, marks unchanged captions, and reports model failures without changing files or
backups. Changing the instruction or model controls clears the preview. The full job generates
fresh results, so its wording may differ from the samples.

## Edit media

Open a file's editor, make changes, then **Apply**. Editor changes render from the original, retained beside the media as a `.bak`, with edit settings in `.edit.json`. Later edits use that original again. **Revert original** restores it and removes the edit files.

- **Images:** crop to preset ratios or a free crop, rotate by quarter turns, mirror, resize by scale or exact dimensions, and use Adjust.
- **Videos:** trim on the timeline, crop, resize, change speed or volume, mute, and use Adjust. Rendering shows progress and can be cancelled.
- **Masks:** add blur, pixelate, or blackout regions to images or videos.
- **Frames:** **Save frame as JPG** writes a video/GIF frame beside the source, named with its timestamp or frame number.
- **GIF to MP4:** converts at 24 fps and asks before overwriting an MP4 of the same name.

Image editing supports JPG/JPEG, PNG, WebP, and BMP; video editing supports MP4, MOV, and M4V when the browser can decode them. See [supported formats](#supported-formats).

While resizing a crop, the preview shows its pixel dimensions. Free crops also show their aspect ratio.

### Adjust in the editor

Adjust provides Exposure, Brilliance, Highlights, Shadows, Contrast, Brightness, Black Point, Saturation, Vibrance, Warmth, Tint, Hue, Definition, and Noise Reduction. Choose a tool, then drag/click its slider or use arrow keys; Shift makes larger steps. Double-click the slider to return to its marked resting value. Scroll the tool row with the mouse wheel when it does not fit.

The **Auto** wand analyzes the original inside the crop, excluding masks; videos are sampled within the trimmed range. It adjusts exposure, contrast, color intensity, and color casts toward a natural look. Its slider sets the amount; click the selected wand again to turn it off.

Hold the compare button to see the original. Click the preview to inspect at output resolution when it exceeds the displayed size, then move the pointer to pan. Live preview needs WebGL 2; saving still works if preview is unavailable.

### Auto-adjust a batch

Run **Auto-adjust** to apply the wand and save each eligible image/video. Crops, masks, trims, and other edits are kept. Existing manual Adjust values remain, while an earlier Auto result is replaced rather than stacked.

**Replace earlier adjustments** resets all Adjust tools before applying Auto, discarding manual adjustments. It starts off each run. Unchanged files and files currently being saved in the editor are skipped. Originals are retained: open the editor to tune the result or revert it. Cancelling keeps completed files.

To remove color changes from a batch, open **Auto-adjust** and select **Reset all color adjustments to zero**. This clears manual and automatic color adjustments without applying Auto. Crops, masks, trims, and other edits stay in place. This option also starts off each run.

## Jobs

**Scope:** selected files limit most jobs; with no selection, the job uses the whole open folder. Filters alone do not limit a job: select the filtered files first. **Quick LoRA training** always uses the whole folder.

Jobs run in the background. The automation panel and jobs drawer show progress, cancellation, warnings, history, and per-file results. **Retry N failed** retries failures; **Run again** uses the whole folder. Cancelling keeps completed writes. A new job replaces the previous history entry for the same job type and folder.

| Job                                        | Result / important option                                                                                                                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto-caption**                           | Generates `.txt` captions from media and folder instructions; needs a [model connection](configuration.md#connect-a-vision-model), skips finished captions, and retries short results according to the [draft threshold](configuration.md#vision-model-settings) |
| **Verify captions** / **Lint captions**    | Write issue findings; captions stay unchanged                                                                                                                                                                                                                    |
| **Edit captions**                          | AI text rewrite; the model sees no media. **Back up captions first** starts on each run                                                                                                                                                                          |
| **Set captions**                           | Writes one caption to all files; existing captions need overwrite permission                                                                                                                                                                                     |
| **Find & replace**                         | Replaces text/regex or adds a prefix/suffix; previews counts and examples before writing                                                                                                                                                                         |
| **Find duplicates**                        | Writes groups for review; deletes media only when confirmed in the resolver                                                                                                                                                                                      |
| **Backup captions** / **Restore captions** | Copy captions to/from `.backup/`; restore overwrites current text                                                                                                                                                                                                |
| **Rename**                                 | Sequential file names with related files; no undo                                                                                                                                                                                                                |
| **Watermark**                              | Text on copies in `watermarked/`, optionally stripping metadata; captions are not copied                                                                                                                                                                         |
| **Strip metadata**                         | Removes embedded provenance in place; no edit backup or built-in undo                                                                                                                                                                                            |
| **Auto-adjust**                            | Saves Auto adjustments while retaining originals; see [batch behavior](#auto-adjust-a-batch)                                                                                                                                                                     |
| **Process with ComfyUI**                   | Stages results for review; [acceptance replaces sources without a backup](comfyui.md#review-candidates)                                                                                                                                                          |
| **Quick LoRA training**                    | Starts and monitors a run in [AI-Toolkit](ai-toolkit.md)                                                                                                                                                                                                         |

Strip metadata keeps image color/density information and video/audio streams; it removes EXIF, XMP, text/workflow metadata, video tags, and chapters. Video is remuxed without re-encoding. Watermark's stripping option affects its copies.

## Settings

Open the toolbar gear or press `Ctrl+,` to change appearance, model connections and input budgets, integration URLs, cache limits, and history retention. **Save** applies field changes; **Reset**, then Save, returns a field to its environment/default value. **Clear** actions take effect immediately, even if you cancel the dialog.

For model recommendations, setup, all variables, and troubleshooting, see [Configuration](configuration.md).

## Supported formats

All listed formats appear in the gallery, take `.txt` captions, and can be sent to AI caption jobs or ComfyUI. The chosen workflow or training model must support the actual media; gallery support does not guarantee integration compatibility.

| Format             | Gallery                                                       | Editing / Auto-adjust | Strip metadata   | Watermark | Embedded ComfyUI workflow |
| ------------------ | ------------------------------------------------------------- | --------------------- | ---------------- | --------- | ------------------------- |
| JPG / JPEG, WebP   | Image                                                         | Image                 | Yes              | Yes       | —                         |
| PNG                | Image                                                         | Image                 | Yes              | Yes       | Yes                       |
| BMP                | Image                                                         | Image                 | Nothing to strip | Yes       | —                         |
| GIF                | Animation and frame capture                                   | Convert to MP4 first  | —                | Yes       | —                         |
| MP4, MOV, M4V      | Playback and frame capture, if the browser supports the codec | Video                 | Yes              | Yes       | Yes                       |
| AVI, MKV, WMV, FLV | Thumbnail only                                                | —                     | —                | —         | —                         |

GIF captioning and verification use its first frame. Video caption jobs sample frames across the clip, even for containers without browser playback. GIF-to-MP4 conversion uses 24 fps and asks before overwriting an existing MP4. A watermarked GIF stays an animated GIF with the original frame timing, loop count, and transparency.

## Files DataForge creates

`<stem>` excludes the extension (`scene`); `<name>` includes it (`scene.jpg`). Sidecar files accompany media but are not gallery items. Output media in `watermarked/` or `staging/` can be browsed as files.

Media with the same stem, such as `scene.jpg` and `scene.png`, share a caption and edit-settings path. Use distinct stems when they need different captions, edits, or processing results.

| File                                  | Location                   | Created by / lifecycle                                                                                                                          |
| ------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `<stem>.txt`                          | Beside media               | Manual or automated captioning; remains until deleted or overwritten                                                                            |
| `.sysprompt`                          | Dataset or parent folder   | System-prompt editor; saving empty removes the current folder's file                                                                            |
| `.captionrules`                       | Dataset or parent folder   | Caption-rules editor; saving empty removes the current folder's file                                                                            |
| `<name>.issue.json`                   | Beside media               | Verify captions and Lint captions; removed when findings are resolved or cleared                                                                |
| `<name>.duplicate.json`               | Beside media               | Find duplicates; removed when the group is resolved, dismissed, or cleared                                                                      |
| `<name>.bak` and `<stem>.edit.json`   | Beside media               | Editor or Auto-adjust original and edit settings; Revert original removes both. Accepting a ComfyUI result also discards them                   |
| `<stem>.txt`                          | `.backup/`                 | Caption backup; remains after restoration until deleted or overwritten                                                                          |
| Watermarked media                     | `watermarked/`             | Watermark copies; captions are not copied                                                                                                       |
| Result and `<result-name>.comfy.json` | `staging/`                 | ComfyUI processing; removed when accepted, rejected, or deleted                                                                                 |
| SQLite database and thumbnail cache   | `backend/data/` by default | Settings, preferences, jobs, notifications, and thumbnails; paths and retention are [configurable](configuration.md#server-storage-and-logging) |

For example, `scene.jpg` can have `scene.txt`, `scene.jpg.issue.json`, `scene.jpg.duplicate.json`, `scene.jpg.bak`, and `scene.edit.json`.

The gallery lists only the open folder's media, not descendants. It omits `.backup/` and common repository, environment, system, and cache folders, including `.git`, `node_modules`, `.venv`, `__pycache__`, `_latent_cache`, and `_t_e_cache`. External file changes appear automatically.

## Keyboard shortcuts

Press `?` outside a text field to see the shortcut list in the app. On macOS, use `⌘` for app shortcuts shown with `Ctrl`, and `⌥` for `Alt`. Caption completion keeps `Ctrl+Space` on macOS too.

### Global and folder navigation

| Shortcut        | Action                                                |
| --------------- | ----------------------------------------------------- |
| `Ctrl+P`        | Open or close **Quick actions** (the command palette) |
| `Ctrl+F` or `/` | Focus gallery search                                  |
| `Ctrl+,`        | Open Settings                                         |
| `?`             | Show keyboard shortcuts                               |
| `Ctrl+O`        | Open the folder picker                                |
| `Alt+↑`         | Go to the parent folder                               |
| `Alt+Home`      | Go to the home folder                                 |
| `Alt+N`         | Create a folder                                       |
| `Enter`         | Confirm a dialog                                      |
| `Escape`        | Close a dialog or viewer                              |

In Quick actions, use `↑`, `↓`, `Home`, and `End` to choose an action, then `Enter` to run it.

### Gallery and selection

| Shortcut                | Action                                                         |
| ----------------------- | -------------------------------------------------------------- |
| `Ctrl+click`            | Toggle an item's selection and enter selection mode            |
| `Shift+click`           | Select the range from the selection anchor to the clicked item |
| `Ctrl+A`                | Select every media file in the current view                    |
| `Delete` or `Backspace` | Delete selected files, after confirmation                      |
| `Escape`                | Clear selection; press again to leave selection mode           |

### Item viewer and review queues

| Shortcut                | Where / action                                                     |
| ----------------------- | ------------------------------------------------------------------ |
| `←` / `→`               | Previous / next item in the viewer or review queue                 |
| `Home` / `End`          | First / last item in the viewer or review queue                    |
| `Ctrl+Enter`            | Item viewer: save the caption and go to the next item              |
| `Delete` or `Backspace` | Item viewer: delete the item, after confirmation                   |
| `Ctrl+Enter`            | Issue resolver: mark resolved; candidate review: accept the result |
| `Ctrl+Backspace`        | Candidate review: reject the result                                |

### Editors

| Shortcut             | Action                                                       |
| -------------------- | ------------------------------------------------------------ |
| `Ctrl+F`             | Find in the focused text editor                              |
| `Ctrl+Space`         | Show caption word completions                                |
| `Escape`             | Close completions before closing the viewer                  |
| Arrow keys           | Nudge a focused crop, mask, or trim handle, or Adjust slider |
| `Shift` + arrow keys | Nudge in larger steps                                        |
| `Delete`             | Remove the focused mask                                      |
| `Home` / `End`       | Video trim handle: jump to the start / end                   |

Video trim handles move one frame per arrow press, or one second with Shift. Adjust sliders return to their resting value when double-clicked.

### Focus and availability

Shortcuts depend on focus. Text editors keep their own search, selection, deletion, and completion keys. Plain-key navigation is ignored while typing; focused video controls use arrow keys to seek. Enter does not confirm from a multi-line field, and busy dialogs suppress actions that would interrupt their operation. Escape can close a menu or editor overlay before the surrounding dialog.
