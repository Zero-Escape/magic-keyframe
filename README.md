# Magic Keyframe

A focused Windows 11 video editor for Byrne Photography's long-form wedding footage.

## Current development scope

- Sony XAVC S 4K 29.97p import
- 48 kHz external recorder audio import
- Proxy-based preview
- Manual audio synchronization with visible waveforms and precise nudging
- Beginning/end trims and middle cuts on camera and external audio
- Multi-select moves and linked A/V clips with linked splitting
- Undo/redo, .mkproj save/load, media thumbnails, zoomable stereo waveforms
- 4K MP4 delivery with NVIDIA NVENC acceleration

## Windows: download and run (recommended)

[**Download the latest Windows portable ZIP**](https://github.com/Zero-Escape/magic-keyframe/releases/latest/download/Magic-Keyframe-Windows-Portable.zip)
· [Release notes and downloads](https://github.com/Zero-Escape/magic-keyframe/releases/latest)

1. Download **Magic-Keyframe-Windows-Portable.zip** from Releases, not the source-code ZIP.
2. Right-click the ZIP → **Extract All** into a new folder.
3. Open that folder and double-click **Magic Keyframe.exe**.

No Git, Node.js, terminal, or installation required. Keep the entire extracted folder,
including `resources/`. You can make a desktop shortcut to the executable.

For updates, close the old app, download the latest portable ZIP, and extract it into
a new folder. Open your `.mkproj` project from **File → Open project**. Keep your original
media files; project files contain references, not copies of the footage. Automatic
in-app updating is not implemented. The build is unsigned and still an early test build.

## Developers: Windows clone and run

Install **Git for Windows** and **Node.js 24 LTS** first. In PowerShell:

```powershell
git clone https://github.com/Zero-Escape/magic-keyframe.git
cd magic-keyframe
npm ci
npm start
```

`npm start` prepares the media runtime, builds the app, and opens the desktop editor.
The first setup downloads a pinned Windows FFmpeg binary and verifies its SHA-256.
Client footage, proxies, generated builds, and downloaded executables are not in Git.

### Updating your clone

Close the app, open PowerShell in the cloned `magic-keyframe` folder, then run:

```powershell
git pull --ff-only
npm ci
npm start
```

This runs the app from your clone. It does **not** update a separate portable folder
you previously extracted. To make a new standalone Windows ZIP instead, run
`npm run package:portable` and use the ZIP in `release/`.

### Development and checks

`npm run dev` launches the hot-reloading Vite/Electron development mode.
`npm run verify:media` contains the legacy source-cut media regression checks; it
does not yet cover placement-aware timeline rendering or linked editing.
Windows GitHub Actions builds a portable ZIP on pushes to main;
tagged version builds publish the portable ZIP and its SHA-256 to GitHub Releases.
The installer build is separate (`npm run package:win`) and does not block portable releases. GitHub Actions runs must finish before
their downloadable artifacts are available.

## Editing

Drop local media anywhere in the project window, or use Import. This build uses one
camera source and one optional recorder source; both can be split into many clips.

### Select, move and link clips

- **Click** a clip to select it. **Ctrl+click** or **Shift+click** adds/removes clips
  from the selection, across both tracks. **Ctrl+A** selects all clips; **Esc** clears.
- Drag any selected clip body to move **the whole selection by the same amount**.
  Source trim points and relative timing do not change. Only the chosen clips move;
  dragging an audio clip no longer shifts every audio section automatically.
- Align the recorder audio, select the matching video and audio, then click **Link**
  (**Ctrl+L**). A chain icon marks linked clips. Clicking either partner selects the
  group; moving or nudging it moves all partners without changing their sync.
- Click **Unlink** (**Ctrl+Shift+L**) when you want to adjust a partner independently.
- Edges snap to neighboring clip edges and the playhead while dragging. Hold **Alt**
  to disable snapping. Moves stop at same-track neighbors rather than overwriting
  them. Video cannot move before zero; audio can have pre-roll before zero.

### Cut out a middle section and close the gap

1. Link the synchronized video/audio first.
2. Select the pair, scrub the ruler to the start of the unwanted section, then
   click **Split** (**Ctrl+B**). Scrub to its end and split again.
3. Click the middle video or audio clip, then **Remove** (or **Delete**). Both linked
   middle pieces are removed.
4. Click either remaining ending clip and drag left until it snaps to the earlier
   pair. The ending video and audio move together, keeping their sync.

Splitting a linked group cuts all partners crossing that timeline point and creates
**separate left and right linked groups**. Moving the ending group does not move the
beginning group. You can also Ctrl/Shift-select unlinked video and audio pieces and
move them together without linking them permanently.

Drag either edge to refine a trim; the IN/OUT fields use source seconds. Trimming
one linked partner changes its boundary, not the timing of its remaining content.
The ±1 frame buttons nudge the selection, including linked partners. Moving, trimming, splitting or removing clips pauses playback. Selecting, trimming, or dragging clips does not move the paused playhead;
use the ruler or empty track space to seek. Scrubbing retains the clip selection.

Cuts leave gaps until you move clips to close them. **Preview and export now honor
the actual timeline**, including black video/silent camera audio in gaps. External
audio can continue across a video gap. Export ends at the last clip on either track,
so trim unwanted audio tails if you do not want black video after the last picture.

The mouse wheel zooms around the pointer; Shift+wheel or horizontal trackpad scrolling
scrolls. Sidebar/timeline dividers resize the workspace. Waveforms show signed 5 ms
stereo envelopes, with more detail as you zoom; waveform analysis and thumbnails cache
locally.

Each track has an independent mute switch. Video 1 also has a visibility switch. These
settings affect both preview and export; hidden video exports as black with audio
controlled separately. Importing external audio mutes camera audio by default; unmute
both to compare sync (both enabled sources are mixed on export).

The current build handles one video and one optional external audio track. It exports
the arranged timeline as one 8-bit H.264 4:2:0 MP4 with AAC audio. Multiple source
files per track, automatic waveform sync, and extra tracks are not yet implemented.

For a Windows test build from Linux, run `npm run package:portable`. The setup
step obtains a Windows-native FFmpeg executable instead of packaging the Linux one.
The portable ZIP runs after extraction; it is not an installer. Its Windows media
executable is unpacked outside ASAR so proxy and export processes can execute it.

The placement-aware render path, linked editing and native Windows interactions need
hands-on checking; compilation and archive checks are not runtime verification.

## Projects and undo

Use **File → Save project** / **Ctrl+S** to write a `.mkproj` file. **Ctrl+Shift+S**
saves a copy; **Ctrl+O** opens a project; **Ctrl+N** starts a new one. The toolbar has
New, Open, and Save buttons too. Unsaved edits are marked with a dot, and opening,
starting a new project, or closing the editor prompts Save / Discard / Cancel.

Projects store imported media references, all video/audio source cuts and timeline
positions, clip links, mute/visibility settings, playhead position, zoom and panel sizes. **They do
not embed your original footage.** Keep the originals; move them together with the
project when possible. Relative paths are tried first, then the saved absolute path.
If media is missing, the editor asks you to locate it; cancel leaves your current
project intact. After locating moved files, save the project to retain the new paths. Proxies, thumbnails and waveforms regenerate/cache locally.

**Ctrl+Z** undoes and **Ctrl+Shift+Z** or **Ctrl+Y** redoes up to 100 project edits,
including imports, trims, splits, removal, group moves, linking/unlinking and track switches.
A drag is one undo step. Playback, selection and zoom are not edit-history steps.
History is session-only and starts fresh when a project is opened; your saved edits
are retained. Save is manual (no autosave/recovery yet).

### Project compatibility

Version 0.3.0 reads existing version-1 projects from 0.2.0, preserving their visible
source-time positions and recorder offset. Saving writes **version 2**, which stores
independent placements and links. Version-2 projects cannot be reopened in 0.2.0;
use **Save as** to keep an old-format copy if you need one. Links survive save/load.
Existing source-cut gaps now remain black/silent on export until closed on the timeline.

### Opening `.mkproj` files from Explorer

The optional Windows **Setup installer** is configured to register the project file type. The portable ZIP
does not alter your Windows settings automatically. When running from a Git clone,
you can register the current checkout for your Windows account (no admin needed):

```powershell
npm run associate:projects
```

Keep the clone at that location afterward, or rerun that command after moving it.
Windows may ask which application to use for `.mkproj`; choose the registered app.
Double-clicking a project opens it in the existing editor, with an unsaved-changes
prompt if needed. Projects opened from Explorer during import/export are queued until the operation finishes. Registry/file-association behavior still needs
a hands-on Windows check; a successful Linux build cannot prove that behavior.
