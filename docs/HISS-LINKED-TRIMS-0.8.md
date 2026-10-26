# Hiss cleanup and linked trims — 0.8.0

## Linked timing semantics

Trim the linked group atomically by one shared delta, not by copying the active
clip's source IN/OUT (camera and recorder source clocks differ). Keep any existing
stagger between partner edges. Start trim adds delta to both source start and
placement, leaving content timing and the opposite edge unchanged; end trim adds
delta to source end. Trimming does not seek the paused playhead or auto-close gaps.

Intersect source bounds, timeline-zero and minimum-length constraints across every
partner, then clamp the shared delta before invalid lane ordering/nested/triple
overlaps. Apply all members together, never partially. Unlink to edit one partner.
Mouse drags derive edits from a fixed pre-gesture snapshot and scale, avoiding
incremental rounding drift/handle jumps; the group gets one undo snapshot. Numeric
IN/OUT uses the same operation and restores fields to the accepted/clamped values.

Split already expanded linked selection and generated matching left/right groups.
It now rejects a cut leaving an undersized crossing member instead of allowing one
valid partner to authorize tiny fragments in others. Partners outside the cut time
cannot be split; they stay with the corresponding side. Existing overlap cut guards
remain. Clip effects/fade handles are still independent, not copied to linked audio.

## Steady mic hiss

New `hiss` effect, 0–18 dB reduction setting; default off preserves old projects.
When active: resample to 48kHz so the 8kHz shelf is valid even for low-rate sources,
then one `afftdn` spectral pass uses max(noise,hiss), white-noise model,
tracking and gain smoothing radius 6. Hiss-only starts at -50dB noise floor;
existing generic-noise mode retains -40dB when also enabled. A gentle two-pole
8kHz treble shelf reduces gain by hiss/6, up to 3dB. The shelf is not a hard cutoff.
The parameter is a DSP setting, not a measured guarantee of that much noise removal.

Gentle 6dB and Stronger 12dB presets change only hiss; Off leaves other audio effects
alone. Apply prepares the continuous float audio cache shared by preview/export.
Hiss participates in validation, preview cache keys, measurement, project v6,
undo/redo and export. Noise+hiss are not two stacked denoisers. Hiss=0 leaves the
old filter strings/cache behavior unchanged. Gain/fades remain live; hiss drafts
are not committed/prepared until Apply, consistent with other adaptive effects.

This targets steady broadband preamp/mic hiss, not ringing feedback, electrical hum,
wind or voice isolation. Strong cleanup/leveling can dull speech, produce artifacts
or lift residual noise. Headphone audition is necessary; original media stays intact.

## Filter compatibility sources

Checked options/ranges against shipped Windows FFmpeg 6.1.1 source (not execution):
- https://github.com/FFmpeg/FFmpeg/blob/n6.1.1/libavfilter/af_afftdn.c
  `nr`, `nf`, white `nt=w`, `tn`, `gs=6`.
- https://github.com/FFmpeg/FFmpeg/blob/n6.1.1/libavfilter/af_biquads.c
  treble `f`, `g`, Q width type `t=q`, `w=0.707` (default two poles).

## Camera note / future workflow

Gary now records Sony FX2 S-Cinetone, still 10-bit 4:2:2 4K. S-Cinetone is not S-Log;
no automatic S-Log LUT should be applied. Format/codec requirements and current
8-bit Rec.709 delivery are unchanged. No profile autodetection/HDR/Log transform
is introduced here. Product reference: https://pro.sony/en_GB/products/handheld-camcorders/ilme-fx2

## Verification boundary

Source review and production/Windows package compilation/inspection only. No new
runtime implementation/UI/audio tests run in this pass. Confirm linked start/end
trims, staggered offsets, source/zero limits, split/undo/save/reopen and a short
hiss-cleaned export with the user's actual Windows project before relying on these
new features. Prior real-world success in 0.7.1 does not validate new 0.8.0 behavior.
