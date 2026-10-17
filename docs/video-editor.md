# Video editor

[Documentation](README.md) | [User guide](user-guide.md)

The clapperboard in a video's viewer opens a multi-track editor for MP4, MOV, and M4V files. It starts a project with that video at 00:00 on V1 and, when it has sound, the sound linked on A1. **Open video editor** in the sidebar instead starts an empty project in the open folder; the first video added to it sets its frame size, frame rate, and name. Tracks have fixed positions: a clip stays where it is put, and a clip dragged into another one stops flush against it.

- **Media** lists the open folder's videos, images, and audio files. Click one to preview it as the **Source**, set in and out points, then **Add to timeline**, or drag it onto a track. Files are referenced, never copied.
- **Timeline** has Select, Blade, Range, Ripple trim, and Roll trim tools, split, duplicate, delete, undo, snapping, and zoom. Higher video tracks cover lower ones. Tracks can be renamed (double-click), reordered, locked, hidden, muted, or soloed; empty tracks can be removed.
- **Clip pictures:** video clips show frames and sound clips a waveform, one lane per channel (left above right). Both are drawn for the stretch in view at the zoom's level of detail, so zooming in shows the frames and transients of that stretch rather than a stretched overview.
- **Selecting:** drag over empty lane space to select every clip the box touches (`Shift` adds to the selection). `Ctrl+A` selects every clip, `A` every clip that starts at or after the playhead, and `Shift+A` the same on the selected clips' tracks only.
- **Ripple and roll:** with **Ripple trim**, dragging a clip's edge moves everything that starts after the clip by the time it gained or lost, so no gap opens; dragging its start changes where the take begins while the clip stays where it starts. `Shift+Q` and `Shift+W` ripple trim the clip under the playhead to it. With **Roll trim**, dragging the cut between two touching clips moves it, trimming both, while everything else keeps its time. Neither works inside a dissolve or crossfade.
- **Sync lock:** the chain-link button in a track's header. Ripple delete, insert, and ripple trims move every track with sync lock on, and leave the others where they are, except for sound linked to a picture they move. A ripple that would push two clips on a track into each other is refused; turn off that track's sync lock to leave it alone.
- **Markers:** `M` adds a marker at the playhead, for beats, lyric lines, or shot notes. Markers show as flags on the ruler (click one to jump to it), edits snap to them, and `Shift+↑` / `Shift+↓` step between them. With nothing selected, the inspector's **Markers** panel names them, adds a note, moves them by time, finds them by text, and removes them. Edits never move a marker.
- **Linked clips:** a video's sound moves, trims, splits, retimes, and deletes with it. Unlink it in the inspector to edit either alone.
- **Replace and insert:** with one clip selected, a file previewed in **Source** can **Replace** it: the new take keeps the clip's start, track, link, look, gain, fades, and dissolves. A longer take is cut to the slot; a shorter one ends the clip early and leaves a gap, and is refused when that would undo a dissolve. **Fit to fill** retimes the marked range to fill the slot exactly, between 0.25× and 4×. A new take without sound drops the old linked sound; one with sound replaces it, or is added on a free audio track. **Insert** places the file at the playhead and moves everything after it later on every track, cutting what crosses the playhead; it is refused while a track it would move is locked.
- **Exact timing:** the inspector's **Start**, **In**, and **Length** fields and the transport's playhead time take a timecode, frames (`36f`), seconds (`1.5s`), or `+12`/`-3` frames. **In** slips the take inside a clip that stays put.
- **Copy and paste:** clips are copied with their linked sound and dissolves and pasted at the playhead, also into another project opened in the same session. **Paste attributes** gives the selected clips the first copied clip's color, transform, crop, fades, gain, or title style.
- **Several clips:** with more than one selected, the inspector sets fades, gain, fit, scale, opacity, a still or title length, or a saved grade on all of them as one undo step.
- **Saved grades:** the Color panel saves a clip's adjustments under a name and applies a saved grade to a clip or a selection, in any project.
- **Ripple delete** removes a range marked with the Range tool, or with `I` and `O` at the playhead, from every track with sync lock on and closes the gap. It is refused while a track it would change is locked.
- **Inspector:** transform, crop, fit or fill, Adjust colors with **Auto**, speed (sound keeps its pitch), gain, fades, and title text, font, and style. Titles move, scale, and turn like any picture. Titles can use any font installed on this computer; one that is missing draws in the default font. Double-click a slider's label to reset it. A **cross-dissolve** slides the next clip back over the selected one; its length is the overlap, and pulling the clips apart removes it.
- **Animation:** the diamond beside Position, Scale, Rotation, Opacity, and a sound's Gain adds a keyframe at the playhead. Once a setting has one, moving its slider, or dragging the clip in the monitor, sets a keyframe at the playhead instead of the whole clip's value. The arrows step between keyframes, and the list between them shapes the way to the next one: **Linear**, **Ease in**, **Ease out**, **Ease in and out**, or **Hold**. Keyframes show as diamonds on the clip, and a gain envelope as a line over the sound; they stay with the picture when the clip is split, trimmed, or retimed.
- **Crossfades:** sound clips on one audio track may overlap the next clip; the overlap cross-fades between them. A clip may not cover another whole, and only two clips sound at once. **Fades** in a sound's Audio panel sets the shape of its fades and crossfades: **Equal power** (the default) keeps a crossfade's loudness steady, **Linear** dips in the middle.
- **Mix:** with nothing selected, the inspector's **Mix** panel sets each audio track's level and the **Master** level. The microphone marks a track as speech: while one of its clips sounds, the other tracks drop to the **Duck to** level, easing down just before the speech and back up after it.

Projects save as you edit to `<stem>-edit.video-project.json` in the folder. They appear under **Video projects** in the gallery, above the media, and in the editor's **Projects** tab; click one to reopen it. A missing or changed source is listed with **Relink** and **Use the changed file**; nothing is substituted, and export waits until each is resolved.

- **Preview problems:** a source the browser cannot play is named above the monitor with why (for example an unsupported codec) and drawn as a marked box instead of holding playback. **Retry** loads it again; **Use an H.264 copy** writes `<stem>-h264.mp4` beside a video and relinks the project to it, leaving the original untouched.
- **Preview fidelity:** the transport shows the size the monitor draws at, and notes when color-adjusted clips are drawn from a reduced copy or cannot be colored in this browser. The image button renders the frame at the playhead with the export's own renderer at full size, to check what the export will show.
- **Mix meter:** while playing, the transport shows the preview mix's peak per channel; it turns amber above -1 dB and latches **Clip** at full scale until clicked.
- **Scopes:** the waveform button over the monitor shows a luma waveform and an RGB histogram of the picture as the monitor draws it, with the share of it crushed to black or clipped to white.
- **Compare:** the split-square button holds the frame at the playhead as a reference. Move to another shot, or change this one, and drag the divider to wipe between the held frame on the left and the live picture on the right.
- **Versions:** saving keeps an automatic checkpoint every ten minutes of editing (the newest 30) in the app's database. **Project actions > Versions...** saves the edit under a name and restores any version as one undoable edit; **Duplicate project** saves a copy and continues in it.

With a range marked or clips selected, **Export** can also render only that **Part**: the marked range or the selected clips' span, to `<stem>-edited-range.mp4` by default. A part is for checking a passage, so it is written without the project snapshot or a caption.

**Export** renders the whole timeline from the source files to a new MP4 in the folder, `<stem>-edited.mp4` by default, numbered when that name or one of its sidecars is taken. It keeps running after you return to the gallery, can be cancelled, and leaves nothing behind when cancelled or failed. Beside the video it writes `<name>.video-project.json`, the edit it was made from; opening the video in the editor rebuilds that edit as a new draft. **Copy initial video's caption** is off by default. **Sound** defaults to **Limit peaks**, which holds true peaks at -1 dB so loud clips summed together cannot clip; **Normalize** first brings the whole mix to -14 LUFS with one gain; **As mixed** leaves it unprocessed. A finished export reports its measured loudness and true peak, and warns when the sound clips.

## Keyboard shortcuts

On macOS, use `⌘` for app shortcuts shown with `Ctrl`.

Outside text fields, the video editor uses its own keys; gallery shortcuts stay off while it is open.

| Shortcut                       | Action                                             |
| ------------------------------ | -------------------------------------------------- |
| `Space`                        | Play or pause                                      |
| `←` / `→`                      | Step one frame back / forward                      |
| `↑` / `↓`                      | Jump to the previous / next edit                   |
| `Home` / `End`                 | Go to the start / end                              |
| `I` / `O`                      | Mark in / out at the playhead                      |
| `Esc`                          | Clear the selection and the range                  |
| `V` / `B` / `R`                | Select / Blade / Range tool                        |
| `T` / `N`                      | Ripple trim / Roll trim tool                       |
| `S`                            | Toggle snapping                                    |
| `+` / `-`                      | Zoom the timeline in / out                         |
| `Shift+Z`                      | Fit the project in the timeline                    |
| `Ctrl+B`                       | Split at the playhead                              |
| `Delete` or `Backspace`        | Delete the selected clips                          |
| `Shift+Delete`                 | Ripple delete the selected range                   |
| `Ctrl+D`                       | Duplicate the selected clips                       |
| `,` / `.`                      | Nudge the selected clips one frame earlier / later |
| `Q` / `W`                      | Trim the start / end to the playhead               |
| `Shift+Q` / `Shift+W`          | Ripple trim the start / end to the playhead        |
| `Ctrl+A`                       | Select every clip                                  |
| `A` / `Shift+A`                | Select from the playhead on / on selected tracks   |
| `M`                            | Add a marker at the playhead                       |
| `Shift+↑` / `Shift+↓`          | Jump to the previous / next marker                 |

| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste clips at the playhead           |
| `Ctrl+Shift+V`                 | Paste attributes onto the selected clips           |
| `Ctrl+Z` / `Ctrl+Shift+Z`      | Undo / redo (`Ctrl+Y` also redoes)                 |
| `Enter` on a clip              | Select it; `Shift+Enter` toggles                   |

While the **Source** monitor shows a file, `Space`, the arrows, `Home`, `End`, `I`, and `O` act on that file instead.
