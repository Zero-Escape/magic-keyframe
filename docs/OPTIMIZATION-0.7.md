# Optimization / audio stabilization — 0.7.0

## Findings and implementation

- Preview used an unconditional requestAnimationFrame WebGL upload/draw loop for
  each decoder, even paused. Use requestVideoFrameCallback for newly presented
  frames plus coalesced editor/seek event redraws. Keep the prior texture on seeks.
  Fallback browsers redraw on editor/media events; no idle busy loop.
- Every playback render serialized the edit fingerprint and sorted neighboring
  clips for every timeline clip. Memoize fingerprints and weak-cache transition
  indices by immutable clip-array identity. Do not mutate arrays after indexing.
- Waveform drawing scanned every raw 5ms bin at fit-to-timeline zoom. Lazy cached
  four-way min/max pyramids bound drawing work to visible pixels while retaining
  true extrema; coarse bins may conservatively include nearby boundary peaks.
- Reuse meter sample buffers. Pause muted lanes instead of silently decoding them.
- One background job per audio/video pool, low-priority subprocesses, explicit
  decoder/filter/encoder thread limits and bounded diagnostic buffers. Stop audio
  and proxy preparation before export; cancel applies to audio preparation too.
- Adaptive audio DSP formerly restarted inside each two-second export window.
  Process continuously once per original source/settings and cache 48k stereo
  float WAV. Preview/export share it; gain/fades/transitions remain clip-local.
  Source size/mtime and filter settings key the cache; writes use temporary files.
  Disk free space is checked before preparation. At 384000 bytes/sec this costs
  about 1.3 GiB/hour per distinct processed setting; caches are not embedded media.
- Compression uses RMS detection, 10ms attack / 250ms release; leveling uses
  dynaudnorm 250ms frames and 15-frame centered smoothing, stereo coupling,
  bounded max gain, RMS target, -50dB normalization floor, alternative boundaries.
  Its lookahead makes continuous preprocessing necessary. A limiter caps DSP peaks.
- Loudness matching measures the selected source range after DSP/manual gain,
  reports EBU R128 integrated LUFS/LRA/true peak, and chooses gain constrained by
  -16 LUFS and -1.5 dBTP. Fades/mixing aren't included. This is not voice isolation
  or a claim that every full mix will meet a delivery loudness standard.
- Add visible fade ramps and audio handles; custom/30-second export range,
  saved export preferences and Show in folder. Range rounding is outward to frames.
- Retry NVENC only on recognized encoder-availability errors, not any FFmpeg failure.
  If moving completed MP4 fails, recover under a new sibling filename; if that also
  fails, preserve scratch output and report its location.

## Primary references consulted

- FFmpeg filters: https://ffmpeg.org/ffmpeg-filters.html#dynaudnorm
- Pinned FFmpeg 6.1.1 dynaudnorm option/source review: https://github.com/FFmpeg/FFmpeg/blob/n6.1.1/libavfilter/af_dynaudnorm.c
- Compression: https://ffmpeg.org/ffmpeg-filters.html#acompressor
- Loudness/192kHz true-peak processing: https://ffmpeg.org/ffmpeg-filters.html#loudnorm
- Decoded-frame scheduling: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback

The configured search endpoint lacked a key; direct primary-document retrieval worked.

## Verification boundary and remaining checks

This pass uses TypeScript/Vite/desktop builds, source review and published ZIP/ASAR
inspection. No runtime/UI/media tests or resource benchmarks were run in this pass.
The Windows portable CI build is packaging evidence, not proof of responsive export
on the user's footage or machine. No hard whole-process RAM/GPU cap is claimed.

Before relying on client output: use Save As on the real project, inspect pause/seek,
splits/overlaps/fade handles and audio after Apply, reopen the saved project, export
30 seconds including a transition, check cancel and UI responsiveness, and listen
for sync/pumping/background-noise lift. Then export the full edit and review it.

Very long floating-point WAV caches may use RF64 beyond 4 GiB; browser RF64 playback
has not been validated. Windows codec support for direct 10-bit 4:2:2 preview still
varies: optional proxies remain available and default off. Existing unexplained
legacy-project failures still need the affected .mkproj/error to diagnose.
