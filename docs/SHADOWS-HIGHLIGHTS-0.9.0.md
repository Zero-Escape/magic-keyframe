# Shadows / Highlights — 0.9.0

## Behavior

Effects → Color adds independent −100…100 controls (1-unit steps), default zero.
Positive values brighten the relevant tones; negative values darken them. Existing
Apply, selected-clip application, reset, bypass, undo and project persistence paths
include the new fields. Linked sound is not graded automatically.

The bounded SDR per-channel curve is:

    out = x + (shadows/100)*x*(1-x)^2 + (highlights/100)*x^2*(1-x)

It is monotonic for all allowed slider combinations and anchors 0 and 1. Processing
order is exposure/warmth/contrast and clipping, tonal curve, saturation, video fades.
This is not highlight reconstruction, RAW processing or HDR tone mapping. Detail
clipped earlier in the pipeline cannot be restored. Per-channel curves can subtly
change saturation; use the saturation control afterward as needed.

WebGL runs the polynomial directly. The software SVG fallback uses memoized
257-entry RGB component-transfer tables, sRGB filter interpolation and saturation.
Export adds a 16-bit RGB LUT only when either new control is nonzero. Neutral new
settings retain the old filter chain. Existing FFmpeg planar-16-bit LUT maxval
behavior has about one 8-bit code value endpoint quantization; no new clipping
policy was introduced. FFmpeg 6.1.1 vf_lut.c supports the shipped LUT formats and
av_expr expression operations; native verification used Linux FFmpeg 7.0.2.

## Project format

Read v1–v7; write v7. Old projects omit both fields and receive zero defaults.
V6 readers reject unknown effect fields, so a version bump is necessary. Use Save
As to keep a prior-format copy. Source footage is not modified.

## Verification

- `npm run build`, `git diff --check`.
- `node scripts/verify-tonal.cjs`: actual RGB48 ramps through FFmpeg, all nine
  extreme/neutral combinations remain monotonic and approximately endpoint
  preserving; neutral identity; lift darks/lower brights with selective falloff.
- 10-bit 4:2:2 fixture, proxy generation, actual buildStudioExport H.264/AAC
  render and duration/pixel-format probe; inspected the encoded gradient frame.
- Native project disk write/read keeps both fields; v3–v6 migration and out-of-range
  rejection. V1/v2 migration uses the pre-existing conversion path.
- Headless Firefox at actual 1600px: real clip selection and range keyboard input,
  live draft, Apply, save/reopen with an injected Electron bridge, comparison
  bypass. Inspected screenshots personally. Shader screenshot samples: neutral
  dark/bright 63/194, adjusted +40/−40 73/184, bypass 63/194.
- Repeated the renderer workflow with WebGL disabled; inspected the software
  fallback capture. Dark/bright samples: neutral 62/193, adjusted 71/183,
  bypass 62/193.
- These are Linux media and renderer checks, not native Windows IPC/dialog,
  display color-management, original-camera-footage or target GPU validation.

Disposable fixtures and screenshots are in ignored `.test-output/tonal/`.
