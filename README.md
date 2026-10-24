# Magic Keyframe

A focused Windows 11 video editor for Byrne Photography's long-form wedding footage.

## Current development scope

- Sony XAVC S 4K 29.97p import
- 48 kHz external recorder audio import
- Proxy-based preview
- Manual audio synchronization with visible waveforms and precise nudging
- Beginning/end trims and middle cuts on camera and external audio
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
`npm run verify:media` builds and runs the rendered media regression checks.
Windows GitHub Actions builds a portable ZIP on pushes to main;
tagged version builds publish the portable ZIP and its SHA-256 to GitHub Releases.
The installer build is separate (`npm run package:win`) and does not block portable releases. GitHub Actions runs must finish before
their downloadable artifacts are available.

## Editing

To remove a middle section, scrub to its beginning and click **Split**, repeat at its
end, click the middle section, then click **Remove**. Drag either edge to refine a cut;
the IN/OUT fields edit the selected section numerically. The timeline zooms and scrolls,
and the sidebar and timeline dividers can be dragged to fit a wide monitor.

Drop local media anywhere in the project window, or use Import. Select Video 1 or Audio 1
to apply Split, Remove, and the IN/OUT fields to that track. Audio-only cuts leave silence
at their original positions; they do not shift later audio. Drag an audio section to shift
the entire external audio track for sync. Selecting, trimming, or dragging clips does
not move the paused playhead; use the ruler or empty track space to seek. The mouse
wheel zooms around the pointer; Shift+wheel (or horizontal trackpad scrolling) scrolls.
Waveforms show signed 5 ms envelopes, with separate stereo channels and more detail
as you zoom. They are cached locally alongside representative video thumbnails.

Each track has an independent mute switch. Video 1 also has a visibility switch. These
settings affect both preview and export; hidden video exports as black with audio
controlled separately. Importing external audio mutes camera audio by default; unmute
both to compare sync (both enabled sources are mixed on export).

The current build handles one video and one optional external audio track. It exports
kept sections as one 8-bit H.264 4:2:0 MP4 with AAC audio. Multiple clips, automatic
waveform sync, and multi-track editing are not yet implemented.

For a Windows test build from Linux, run `npm run package:portable`. The setup
step obtains a Windows-native FFmpeg executable instead of packaging the Linux one.
The portable ZIP runs after extraction; it is not an installer. Its Windows media
executable is unpacked outside ASAR so proxy and export processes can execute it.

Run `npm run verify:media` for rendered media checks of 10-bit 4:2:2 conversion, audio
cut silence/alignment, source mixing/muting, and hidden-video output. Windows native
file dropping and hardware encoding still require a hands-on Windows check.

## Projects and undo

Use **File → Save project** / **Ctrl+S** to write a `.mkproj` file. **Ctrl+Shift+S**
saves a copy; **Ctrl+O** opens a project; **Ctrl+N** starts a new one. The toolbar has
New, Open, and Save buttons too. Unsaved edits are marked with a dot, and opening,
starting a new project, or closing the editor prompts Save / Discard / Cancel.

Projects store imported media references, all video/audio cuts and trims, audio sync
offset, mute/visibility settings, playhead position, zoom and panel sizes. **They do
not embed your original footage.** Keep the originals; move them together with the
project when possible. Relative paths are tried first, then the saved absolute path.
If media is missing, the editor asks you to locate it; cancel leaves your current
project intact. After locating moved files, save the project to retain the new paths. Proxies, thumbnails and waveforms regenerate/cache locally.

**Ctrl+Z** undoes and **Ctrl+Shift+Z** or **Ctrl+Y** redoes up to 100 project edits,
including imports, trims, splits, removal, sync offsets and mute/visibility changes.
A drag is one undo step. Playback, selection and zoom are not edit-history steps.
History is session-only and starts fresh when a project is opened; your saved edits
are retained. Save is manual (no autosave/recovery yet).

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
