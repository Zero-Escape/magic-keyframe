# Stable edge-drag scale and optional snapping — 0.8.1

## Request

The ruler should not re-fit to a newly shortened longest clip until the user lets
go of its trim handle. Add an optional edge magnet for joining/aligning video and
external audio clips across tracks.

## Scale ownership

Use separate `trimDuration` state captured at pointer-down. `timelineDuration`
selects this exact extent during trimming, not max(live project duration, a floor).
Both shrinking and extension retain the initial ruler coordinates through release.
Trim pointer-up/cancel/lost-capture clears only its own lock, guarded by pointer ID
and stopped propagation. Clip-body releases do nothing without their own matching
active gesture and cannot clear the trim lock. Restore/undo clears all gesture state.
The initial snapshot/seconds-per-pixel remains the source of each edit; one gesture
still creates one undo entry. Fit/zoom guards prevent a second scale change mid-trim.
Clip-body moves retain the prior grow-with-extent behavior, not the strict trim lock.

## Snapping

A visible toolbar toggle stores `mk-timeline-snap` in localStorage (default on,
matching the old move-snapping default). Alt bypasses it for the current gesture.
Approximate radius is 8 CSS pixels converted with the gesture's captured scale.

A shared helper considers stationary starts and ends across every video/audio lane,
zero and the playhead. Moving groups contribute both edges; linked trims contribute
only the corresponding changing edge from each partner. Selected/linked clips are
excluded from targets. Every edit still uses one shared delta, preserving sync and
staggered source/timeline offsets. Explicit numeric IN/OUT and keyboard nudges do
not magnet-snap. Source bounds/zero/minimum length/valid two-way overlap constraints
continue to take precedence. A source/overlap clamp that changes the chosen delta
suppresses the alignment guide; magnetic attraction alone is not a trim-limit error.
The gold guide clears on release, cancellation, capture loss, restore or toggle.

Snapping aligns clip boundaries, not audio waveforms; existing assisted sync is a
separate tool. Snapping does not merge clips or remove gaps automatically. Disable
it or hold Alt to intentionally create an overlap/crossfade or preserve a small gap.

## Verification boundary

Source review, TypeScript/Vite/desktop builds and published ZIP/ASAR inspection only.
No runtime implementation/UI tests were requested or run. Windows pointer gestures,
local preference persistence, guide placement, linked limits and undo still need a
hands-on check. No media/export pipeline or project-schema changes (v6 remains).
