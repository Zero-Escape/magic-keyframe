# Magic Keyframe

A focused Windows wedding-video editor. **v0.6.0 is an unsigned development/test build,
not a verified client-delivery system.** New editing, DSP, sync, recovery and rendering
paths need hands-on Windows checking; build/archive checks alone do not prove them.

## Windows: download and run

[**Download the latest Windows portable ZIP**](https://github.com/Zero-Escape/magic-keyframe/releases/latest/download/Magic-Keyframe-Windows-Portable.zip)
· [Release notes](https://github.com/Zero-Escape/magic-keyframe/releases/latest)

1. Download **Magic-Keyframe-Windows-Portable.zip**, not GitHub's source-code ZIP.
2. Close the old app and **Extract All** into a new folder.
3. Double-click **Magic Keyframe.exe**. Keep the whole folder, including `resources/`.

No Git, Node.js or terminal needed. Make a desktop shortcut if desired. Updates are
currently download-and-extract, not automatic in-app updates. Keep your original media.

## Media and tracks

Import/drop camera recordings, recorder files and music. Supported extensions include
MP4, MOV, MXF, WAV, MP3, M4A, AAC, FLAC, OGG and AIFF. The current cap is **200 source
files and 16 video + 16 audio tracks**. Ten-bit 4:2:2 H.264 sources use FFmpeg-generated
Original-media preview is the default. Optional 720p short-GOP proxies can be enabled in the preview toolbar; originals, not proxies, are used for delivery rendering.

- Imports append in sequence on track 1 of their type. Existing media is not replaced.
- **+ on a media item** places another copy at the playhead, using the active compatible
  track. If that position is occupied, a new track is created instead of overwriting.
- **+ V / + A** adds a track. In Effects, the **Timeline track** selector moves the
  active clip between existing tracks, retaining timing and links. Dragging clip edges
  into an adjacent clip on the same track automatically creates a two-way transition.
- Higher-numbered visible video tracks cover lower ones, full-frame. There is no
  picture-in-picture, opacity animation or simultaneous camera-monitor grid yet.
- Each track has independent audio mute; video tracks also have visibility switches.
  Hidden video exposes lower tracks/black; its audio is independently controlled.
  Importing the first recorder/music source mutes the existing camera tracks by default.
- Signed 5 ms stereo waveform envelopes and media thumbnails are cached locally.

Preview generation and processed-audio preparation can take time on long files.
Video/audio preview jobs are bounded. Proxies are off by default; the Use proxies
toolbar toggle starts/cancels generation, with a duration-weighted overall percentage
and per-file percentage/ETA. Direct decoding depends on Chromium codec support;
10-bit 4:2:2 H.264 may need proxies. Nothing starts automatically to conceal a decode failure.

## Select, cut, link and move

Click a clip to select it. **Ctrl/Shift-click** adds/removes clips across tracks.
**Ctrl+A** selects all; **Esc** clears. Drag a selected clip to move the whole selection
by one shared delta. Clicking an already-selected clip without dragging collapses the
selection to that clip/linked group. Source trim points and relative sync are preserved.

**Link** (`Ctrl+L`) locks selected clips into a movement group; **Unlink**
(`Ctrl+Shift+L`) lets you adjust partners independently. Linked partners select, move,
nudge and remove together. **Split** (`Ctrl+B`) splits all selected partners crossing
the playhead into separate left/right linked groups. Select the middle group and
**Remove/Delete**, then move the ending group left to close the gap. Edge snapping
helps; **Alt** disables snapping. Gaps remain black/silent until explicitly closed.

Drag clip edges or edit source-second **IN/OUT** fields to trim. Trimming one linked
partner preserves the timing of its remaining content. ±1 frame steps the playhead;
Alt+left/right nudges the selection. No clips can be moved/extended before zero.
Moving/trimming/splitting/removing pauses playback; mute switches can be used while
playing. Clip editing does not seek the paused playhead. The ruler/empty track space
seeks while preserving selection. **Space** plays/pauses; the wheel zooms around the
pointer, and Shift+wheel/horizontal scrolling moves across the timeline. Panel dividers
resize the ultrawide workspace; the track list scrolls vertically.

## Effects tab

Select a timeline clip, then choose **Effects** beside Media. Controls audition a
**draft**; click **Apply to clip** to make them part of the project/export. Linked
partners do not automatically share effects. Optionally apply all settings to selected
clips of the same type. Reset changes the draft; Apply commits it. Effects are undoable.

### Video and color

Exposure, contrast, saturation and warmth are basic **SDR/Rec.709** controls, not a
calibrated Kelvin white-balance tool or a full grading suite. GPU preview uses an 8-bit
proxy; delivery grading uses source media and a higher-precision RGB intermediate.
Preview is not a mastering/reference display. The comparison toggle bypasses draft
color/video fades. Without WebGL, a compatibility preview reports that warmth is
export-only. No automatic HDR/HLG/PQ tone mapping, Log transform or LUT workflow yet;
convert those sources to SDR externally first.

Fade-in, fade-out and both presets transition **from/to black**, with adjustable
durations. Fades are clamped to half the clip duration so opposing fades cannot exceed
the clip. These standalone fades go through black; overlap transitions instead dissolve directly between pictures. Splitting retains outer fades
and clears newly created inner-edge fades; refine durations afterward if needed.

Video clips also have small gold **triangles along their top edge**. Drag the left
triangle right to fade in from black; drag the right triangle left to fade out to
black. Drag back toward the respective edge to remove the fade. The duration appears
while dragging; zoom in on the timeline for precise placement. These handles apply
immediately (no Effects Apply needed), leave clip placement and the playhead alone,
and make one undo step per drag. Linked audio is not changed. Keyboard-focus a handle
and use left/right arrows (Shift for ten frames), Home to clear, or End for maximum.
The same 10-second / half-clip maximum as the Effects controls applies.

### Audio

Per-clip gain (−60 to +18 dB), fade-in/out, voice clarity, and spectral noise reduction.
Voice clarity uses a rumble high-pass, presence EQ and gentle compression/makeup gain.
Noise reduction uses FFmpeg spectral denoising. This is **not AI voice isolation** and
cannot reliably remove competing voices/music. Start gently: heavy processing can
sound watery or unnatural. Voice/noise settings prepare a cached processed audio
preview on Apply. Gain/fades audition live. The baseline audio preview is AAC; final
render processing uses the originals. Longer files can take time to prepare.

Live track/master meters show levels before the master limiter. Red means reduce gain;
the limiter is not a substitute for balancing sources. Final audio mixes tracks without
auto-normalizing away clip gains, then applies peak limiting before AAC encoding.

## Assisted automatic audio sync

In Effects → Automatic waveform sync, choose a camera clip with embedded audio and a
recorder clip. **Unlink either clip first** if it belongs to an existing movement group.
The analysis compares band-limited RMS envelopes using normalized FFT correlation,
choosing a strong window of up to 90 seconds within the reference clip. Search ranges
are the selected clips' source in/out ranges, 5 seconds to 6 hours.

**Find alignment** proposes an offset and high/medium/low confidence; the match score
is not an accuracy probability. Nothing moves automatically. **Audition both sources**
plays up to 8 seconds with a temporary placement and isolated camera/recorder tracks.
**Apply alignment** commits it and can link the pair. A new audio track is created if
the destination overlaps another clip. Editing the project invalidates stale results.
Shared speech/distinct sounds are needed; quiet, repeated or unrelated audio may give
an ambiguous result. There is no drift correction or automatic multicamera batch sync.

## Projects, autosave and recovery

**Ctrl+S** saves `.mkproj`; **Ctrl+Shift+S** saves a copy; **Ctrl+O** opens;
**Ctrl+N** starts a new project. Unsaved changes have a dot and Save/Discard/Cancel
prompts on project replacement or close. **Ctrl+Z** and **Ctrl+Shift+Z/Ctrl+Y** cover
up to 100 session edits, including imports, lanes, links, effects and group moves.

Projects store media references, source trims, placements, links, track switches,
committed effects and workspace view. **They do not embed footage.** Relative paths
are tried first, then saved absolute paths. Missing files can be located; canceling a
load leaves the current project intact. Save after relinking to retain new paths.

Autosave writes separate recovery copies after **5 seconds idle**, with a **30-second
periodic** check during continuous editing. It retains up to **10 versions per project**
under `%APPDATA%\magic-key\recovery`. It does not overwrite your manual project. After
an interrupted session, a startup banner offers Restore/Dismiss. Restoring leaves the
manual project unchanged until you save. Manual Save/Discard or undoing back to a clean
baseline clears obsolete recovery copies; in-flight writes/cleanup are serialized.
Only committed edits are recovered, not un-applied Effects drafts. Manual saves remain
useful; this is periodic recovery, not a guarantee against every kind of disk/power loss.

v0.5.0 reads existing v1/v2/v3 projects and upgrades them in memory. Saving writes **v4**
for overlap transitions and non-negative placements. Older apps cannot open v4; use **Save as** to
keep an old-format copy if needed. Source media and preview caches stay local.

## Delivery export

Click **Export** to review adjustable settings, then choose a destination and start.
The default is 1080p, source frame rate, good quality, Auto encoder and Low impact.
Choose 4K explicitly when required. Both use compatible **8-bit H.264 4:2:0 Rec.709 MP4
+ 48 kHz stereo AAC**, with fast-start enabled. NVENC is attempted, with x264 fallback.
The render uses a snapshot taken when Export is clicked; later edits do not change it.

Rendering follows actual placements, stacking, mutes, visibility, color and fades.
Video gaps are black; camera audio follows its clips; other audio can continue across
video gaps. Export ends at the last clip on either track (including muted/hidden clips),
so trim unwanted audio tails to avoid black video after the last picture. Mixed camera
resolutions are letterboxed to the output canvas. Sequence frame rate comes from the
first used video source in the media library. No export range/cancel queue yet.

## Developers

Git for Windows and Node.js 24 LTS are required only for source development:

```powershell
git clone https://github.com/Zero-Escape/magic-keyframe.git
cd magic-keyframe
npm ci
npm start
```

To update a clone, close the app and run `git pull --ff-only`, `npm ci`, `npm start`.
This does not update an extracted portable folder. `npm run dev` starts hot reload;
`npm run build` builds renderer and Electron code. `prepare:desktop` pins/checks the
Windows FFmpeg download. Client media, executables, generated output and caches are
ignored by Git. `package:portable` builds a ZIP; optional `package:win` builds NSIS.
Windows Actions builds main artifacts; unused version tags publish portable Releases
and SHA256SUMS. Installer packaging does not block portable releases. The sync worker
is unpacked outside ASAR and uses only Node built-ins.

`npm run verify:media` is the **legacy** source-cut regression script; it does not
cover the current multi-track/effects render or new preview/recovery/sync paths.
No new runtime/interaction/media tests were run during this feature implementation.

The optional Setup installer is configured for `.mkproj` association. Portable ZIPs do
not change registry settings. For a source checkout, `npm run associate:projects`
registers that checkout per-user; keep its path in place or re-register after moving.
Use File → Open in portable builds. Windows association still needs hands-on checking.

### Playback and portable project associations (0.4.2)

Contiguous splits reuse the decoder without a redundant seek. Pausing does not seek
by itself; the graded preview retains the last decoded frame during short buffering
or seeks (intentional empty timeline gaps remain empty). New proxies use 720p,
15-frame GOPs and no B-frames for lighter decoding and faster seeking. When optional proxies are enabled, a one-time
proxy rebuild may be required; originals and export quality are unchanged.

The timeline −1/+1 frame buttons and left/right arrows step the **playhead**. To move
selected/linked clips one frame instead, use Alt+left/right. Collision constraints
can prevent clip moves at neighbours or the start of the timeline.

In the Windows portable app, choose **File → Associate .mkproj files with this app**.
If Windows retains another default, right-click a project → Open with → Choose
another app → browse to this Magic Keyframe.exe → Always. Keep that extracted folder
in place and repeat registration after moving to a new portable version.
**Help → About Magic Keyframe** shows the running version and executable location;
close older running copies before launching the new one. Registration is per-user
and does not bypass Windows' protected default-app choice.

Project reads accept UTF-8/UTF-16LE BOMs and report the failing filename. Loading
shows which media is being inspected; large older projects may need audio/waveform
cache generation. Versions 1–3 remain supported. A specific legacy opening failure
needs the project file/error to diagnose; this update does not claim all such
failures have been reproduced or resolved.

### Automatic overlap transitions (0.5.0)

Select/link video and audio partners, then drag them left over the ends of preceding
clips **on their respective tracks**. The overlap duration is the transition length.
Video uses a direct alpha cross-dissolve (not a dip to black); audio uses equal-power
quarter-sine crossfades before the master limiter. Move clips apart to shorten/remove
the transition. Relative offsets, undo/redo, project persistence and export are retained.
Striped timeline regions mark overlaps. Incoming video alpha replaces the outgoing
picture; explicit black/audio fades at the same inner edges are overridden. Those
video fade handles are disabled until the overlap is removed. Cross-track stacking
is unchanged; overlap blending is for adjacent clips on the same track.

Nested clips, identical start/end boundaries and three-way overlaps are not supported;
moves/trims clamp to retain a valid two-way edit. Splitting within/on an overlap
boundary is disabled: move the playhead outside the overlap first.

All newly moved clips stop at zero, including linked groups. On opening older projects
with negative audio pre-roll, the whole timeline and saved playhead shift right by
the same amount, preserving all source content and relative sync. The timeline extent
now grows during moves to include the last clip; zoom remains under your control and
Fit shows the full edit. Use Save As to keep the original older-project file.

Preview decoder slots look ahead up to one second to prepare the next video/audio
clip. Incoming overlap video stays transparent until a frame is decoded, leaving
the outgoing picture visible while it prepares; this is not full-file transcoding.

### Bounded export and progress (0.6.0)

The export dialog exposes resolution, source/explicit frame rate, quality, video
bitrate ceiling, Auto/NVIDIA/CPU encoder, Low impact/Balanced resource mode and audio
bitrate. Delivery stays 8-bit H.264 4:2:0 Rec.709 MP4 with stereo AAC at 48 kHz.

The previous whole-timeline split/overlay graph could buffer decoded frames for
future cuts, risking severe RAM pressure. Export now renders short, sequential
pieces with individually sought/capped source ranges, pruning fully covered video
layers. Low impact uses up to 2 encoder threads, one decoder thread per input and
one filter worker; Balanced uses up to 4 encoder threads. Both request below-normal
process priority. Preview is unmounted and queued/running proxy encodes are canceled
for export. Proxies remain off until explicitly enabled again. These are conservative
limits, not a hard OS-wide RAM/CPU reservation or a guarantee against all freezes.

Piece boundaries are frame-aligned, with retained clip-local effect times so fades
and overlaps do not restart each piece. Intermediate audio is lossless PCM; delivery
AAC is encoded once during finalization to avoid per-piece AAC priming gaps. Video
is stream-copied into the final MP4. Temporary pieces use destination-drive space;
a conservative free-space estimate is checked before rendering. Very complex slices
(over four video inputs or twelve total simultaneous inputs) fail with an actionable
message rather than building an unbounded render.

Progress reports actual FFmpeg output timestamps with a one-second status heartbeat.
Rendering and finalization each have their **own** percent/ETA; the bar resets when
finalization starts. ETA is an estimate, and MP4 fast-start/index writes may take
additional time near the end. Cancel stops the active encoder and removes generated
temporary pieces. The final destination is replaced only after successful completion;
original media is never an export destination. A hard process kill/power loss can
leave a hidden .mk-render-* scratch directory on the destination drive, which can be
removed after confirming no export is active.

Local/Windows compilation and archive checks do not prove Windows peak memory use,
UI responsiveness, playback accuracy, long-render sync or output quality. These new
paths still require a hands-on real-media run before client delivery.
