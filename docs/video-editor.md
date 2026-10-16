# Video editor

[Documentation](README.md) | [User guide](user-guide.md)

The clapperboard in a video's viewer opens a multi-track editor for MP4, MOV, and M4V files. It starts a project with that video at 00:00 on V1 and, when it has sound, the sound linked on A1. **Open video editor** in the sidebar instead starts an empty project in the open folder; the first video added to it sets its frame size, frame rate, and name. Tracks have fixed positions: a clip stays where it is put, and a clip dragged into another one stops flush against it.

- **Media** lists the open folder's videos, images, and audio files. Click one to preview it as the **Source**, set in and out points, then **Add to timeline**, or drag it onto a track. Files are referenced, never copied.
- **Timeline** has Select, Blade, and Range tools, split, duplicate, delete, undo, snapping, and zoom. Higher video tracks cover lower ones. Tracks can be renamed (double-click), reordered, locked, hidden, muted, or soloed; empty tracks can be removed.
- **Linked clips:** a video's sound moves, trims, splits, retimes, and deletes with it. Unlink it in the inspector to edit either alone.
- **Ripple delete** removes a range marked with the Range tool, or with `I` and `O` at the playhead, from every track and closes the gap. It is refused while a track it would change is locked.
- **Inspector:** transform, crop, fit or fill, Adjust colors with **Auto**, speed (sound keeps its pitch), gain, fades, and title text, font, and style. Titles can use any font installed on this computer; one that is missing draws in the default font. Double-click a slider's label to reset it. A **cross-dissolve** slides the next clip back over the selected one; its length is the overlap, and pulling the clips apart removes it.

Projects save as you edit to `<stem>-edit.video-project.json` in the folder. They appear under **Video projects** in the gallery, above the media, and in the editor's **Projects** tab; click one to reopen it. A missing or changed source is listed with **Relink** and **Use the changed file**; nothing is substituted, and export waits until each is resolved.

- **Preview problems:** a source the browser cannot play is named above the monitor with why (for example an unsupported codec) and drawn as a marked box instead of holding playback. **Retry** loads it again; **Use an H.264 copy** writes `<stem>-h264.mp4` beside a video and relinks the project to it, leaving the original untouched.
- **Preview fidelity:** the transport shows the size the monitor draws at, and notes when color-adjusted clips are drawn from a reduced copy or cannot be colored in this browser. The image button renders the frame at the playhead with the export's own renderer at full size, to check what the export will show.
- **Mix meter:** while playing, the transport shows the preview mix's peak per channel; it turns amber above -1 dB and latches **Clip** at full scale until clicked.
- **Versions:** saving keeps an automatic checkpoint every ten minutes of editing (the newest 30) in the app's database. **Project actions > Versions...** saves the edit under a name and restores any version as one undoable edit; **Duplicate project** saves a copy and continues in it.

**Export** renders the whole timeline from the source files to a new MP4 in the folder, `<stem>-edited.mp4` by default, numbered when that name or one of its sidecars is taken. It keeps running after you return to the gallery, can be cancelled, and leaves nothing behind when cancelled or failed. Beside the video it writes `<name>.video-project.json`, the edit it was made from; opening the video in the editor rebuilds that edit as a new draft. **Copy initial video's caption** is off by default. **Sound** defaults to **Limit peaks**, which holds true peaks at -1 dB so loud clips summed together cannot clip; **Normalize** first brings the whole mix to -14 LUFS with one gain; **As mixed** leaves it unprocessed. A finished export reports its measured loudness and true peak, and warns when the sound clips.

## Keyboard shortcuts

On macOS, use `⌘` for app shortcuts shown with `Ctrl`.

Outside text fields, the video editor uses its own keys; gallery shortcuts stay off while it is open.

| Shortcut                  | Action                             |
| ------------------------- | ---------------------------------- |
| `Space`                   | Play or pause                      |
| `←` / `→`                 | Step one frame back / forward      |
| `↑` / `↓`                 | Jump to the previous / next edit   |
| `Home` / `End`            | Go to the start / end              |
| `I` / `O`                 | Mark in / out at the playhead      |
| `Esc`                     | Clear the selection and the range  |
| `V` / `B` / `R`           | Select / Blade / Range tool        |
| `S`                       | Toggle snapping                    |
| `+` / `-`                 | Zoom the timeline in / out         |
| `Shift+Z`                 | Fit the project in the timeline    |
| `Ctrl+B`                  | Split at the playhead              |
| `Delete` or `Backspace`   | Delete the selected clips          |
| `Shift+Delete`            | Ripple delete the selected range   |
| `Ctrl+D`                  | Duplicate the selected clips       |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo (`Ctrl+Y` also redoes) |
| `Enter` on a clip         | Select it; `Shift+Enter` toggles   |

While the **Source** monitor shows a file, `Space`, the arrows, `Home`, `End`, `I`, and `O` act on that file instead.
