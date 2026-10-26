# Export piece EOF correction — 0.7.1

## Evidence from supplied media

The supplied 3840x2160 H.264/NVENC 30000/1001-fps MP4 is ~7.04 seconds long.
Decoded-frame inspection found black at 4.905s (one frame, until 4.938s) and the
last frame at 7.007s. Adjacent decoded pictures show normal wedding footage. Packet
inspection places a keyframe at 4.938s; the preceding piece contains a black final
frame, so this artifact is encoded rather than only a live-preview/player issue.

The supplied project has an audio split at 318.9519666666667s (frame 9559).
Balanced's next 120-frame piece boundary is 322.95596666666665s, and the frame just
before it is 322.9226s. This agrees with the reported full-render flash at 5:22–5:23.
No timeline picture gap, black fade or video cut exists at that location. Audio
boundaries also split render pieces even when the picture is continuous.

## Focused correction

`overlay=eof_action=pass:repeatlast=0` revealed the black base as soon as the picture
input ended. Sought/time-limited inputs, fps conversion and time-base rounding can
finish picture a frame short. Use `eof_action=repeat:repeatlast=1`, still gated by
explicit per-clip/window enable bounds. This holds a picture only while that clip
is intentionally active, not through real timeline gaps or past its ending.

Read at most two extra frames after each internal input window, bounded by the
clip's source trim end. The existing final video/audio trims and output-frame limit
still define delivery content; the extra input tail only supports conversion.
Decoder/filter/thread caps, sequential piece size and cancellation are unchanged.

## Scope of verification

Read-only analysis of the user-supplied encoded file, timestamps and project plus
source review, TypeScript/Vite compilation and packaged-release inspection. No new
runtime implementation tests or source-footage re-render were run. The source
camera/recorder files are on the user's Windows PC. The same short export range
must be re-rendered there to confirm the real-footage correction; this is not a
claim that all possible black-frame causes have been eliminated.

Client media/project files and extracted frames remain local and ignored; none are
published in the repository or release.
