import { type ClipEffects } from './effects.js'
// Shared, immutable timeline operations. Source time is start/end; placement is at.
export type Track = 'video' | 'audio'
export type Segment = { id: string; start: number; end: number; at: number; linkId?: string; mediaId: string; lane: number; effects?: Partial<ClipEffects> }
export type Lane = { name: string; muted: boolean; hidden: boolean }
export type TimelineEdit = { video: Segment[]; audio: Segment[]; lanes: { video: Lane[]; audio: Lane[] } }
export const emptyEdit = (): TimelineEdit => ({ video: [], audio: [], lanes: { video: [{ name: 'Video 1', muted: false, hidden: false }], audio: [{ name: 'Audio 1', muted: false, hidden: false }] } })
export const tracks: Track[] = ['video', 'audio']
export const length = (clip: Segment) => clip.end - clip.start
export const endAt = (clip: Segment) => clip.at + length(clip)
export const activeClip = (clips: Segment[], time: number) => clips.find((clip) => time >= clip.at && time < endAt(clip))
export const timelineEnd = (edit: TimelineEdit) => Math.max(0, ...tracks.flatMap((track) => edit[track].map(endAt)))
export const ordered = (clips: Segment[]) => [...clips].sort((a, b) => a.at - b.at)
const all = (edit: TimelineEdit) => [...edit.video, ...edit.audio]
const map = (edit: TimelineEdit, fn: (clip: Segment, track: Track) => Segment): TimelineEdit => ({ ...edit, video: edit.video.map((c) => fn(c, 'video')), audio: edit.audio.map((c) => fn(c, 'audio')) })
export function linkedSelection(edit: TimelineEdit, ids: string[]) {
  const chosen = new Set(ids), links = new Set(all(edit).filter((c) => chosen.has(c.id) && c.linkId).map((c) => c.linkId))
  return all(edit).filter((c) => chosen.has(c.id) || (c.linkId && links.has(c.linkId))).map((c) => c.id)
}
function pruneLinks(edit: TimelineEdit) {
  const counts = new Map<string, number>()
  all(edit).forEach((c) => { if (c.linkId) counts.set(c.linkId, (counts.get(c.linkId) || 0) + 1) })
  return map(edit, (c) => c.linkId && counts.get(c.linkId)! < 2 ? { ...c, linkId: undefined } : c)
}
export function linkClips(edit: TimelineEdit, ids: string[], createId = () => crypto.randomUUID()) {
  const selected = new Set(linkedSelection(edit, ids))
  if (selected.size < 2) return edit
  const linkId = createId()
  return map(edit, (c) => selected.has(c.id) ? { ...c, linkId } : c)
}
export function unlinkClips(edit: TimelineEdit, ids: string[]) {
  const selected = new Set(linkedSelection(edit, ids))
  return map(edit, (c) => selected.has(c.id) ? { ...c, linkId: undefined } : c)
}
export function removeClips(edit: TimelineEdit, ids: string[]) {
  const selected = new Set(linkedSelection(edit, ids))
  return pruneLinks({ ...edit, video: edit.video.filter((c) => !selected.has(c.id)), audio: edit.audio.filter((c) => !selected.has(c.id)) })
}
// Overlaps are edge-to-edge transitions, not nested clips or triple overlaps.
export function validLane(clips: Segment[]) {
  const sorted = ordered(clips)
  return sorted.every((c, i) => c.at >= -1e-7 && (!i || c.at > sorted[i - 1].at + 1e-7 && endAt(c) > endAt(sorted[i - 1]) + 1e-7) && (i < 2 || c.at >= endAt(sorted[i - 2]) - 1e-7))
}
const transitions = new WeakMap<Segment[], Map<string, { incoming: number; outgoing: number }>>()
export function transitionEdges(clips: Segment[], clip: Segment) {
  let index = transitions.get(clips)
  if (!index) {
    index = new Map(); const lanes = new Map<number, Segment[]>()
    for (const c of clips) { const lane = lanes.get(c.lane) || []; lane.push(c); lanes.set(c.lane, lane) }
    for (const lane of lanes.values()) {
      lane.sort((a, b) => a.at - b.at)
      lane.forEach((c, i) => index!.set(c.id, { incoming: i ? Math.max(0, endAt(lane[i - 1]) - c.at) : 0, outgoing: i + 1 < lane.length ? Math.max(0, endAt(c) - lane[i + 1].at) : 0 }))
    }
    transitions.set(clips, index)
  }
  return index.get(clip.id) || { incoming: 0, outgoing: 0 }
}
export function transitionGain(clips: Segment[], clip: Segment, time: number) {
  const { incoming, outgoing } = transitionEdges(clips, clip), local = time - clip.at
  return Math.sin(Math.PI / 2 * Math.max(0, Math.min(1, incoming ? local / incoming : 1))) * Math.sin(Math.PI / 2 * Math.max(0, Math.min(1, outgoing ? (endAt(clip) - time) / outgoing : 1)))
}
export function moveClips(edit: TimelineEdit, ids: string[], requested: number, snapDistance = 0, playhead?: number) {
  const selected = new Set(linkedSelection(edit, ids)), moving = all(edit).filter((c) => selected.has(c.id))
  if (!moving.length || !Number.isFinite(requested)) return { edit, delta: 0 }
  const min = -Math.min(...moving.map((c) => c.at))
  let delta = Math.max(min, requested)
  const targets = [0, ...(playhead === undefined ? [] : [playhead]), ...all(edit).filter((c) => !selected.has(c.id)).flatMap((c) => [c.at, endAt(c)])]
  let nearest = snapDistance
  for (const c of moving) for (const edge of [c.at, endAt(c)]) for (const target of targets) {
    const distance = Math.abs(target - edge - requested)
    if (target - edge >= min && distance < nearest) { nearest = distance; delta = target - edge }
  }
  const shifted = (value: number) => map(edit, (c) => selected.has(c.id) ? { ...c, at: Math.max(0, c.at + value) } : c)
  const valid = (next: TimelineEdit) => tracks.every((track) => next.lanes[track].every((_, lane) => validLane(next[track].filter((c) => c.lane === lane))))
  // Preserve ordering and clamp before a clip would swallow another, or a third
  // simultaneous clip would make the intended two-way transition ambiguous.
  if (!valid(shifted(delta))) {
    let low = 0, high = 1
    for (let i = 0; i < 28; i++) { const fraction = (low + high) / 2; if (valid(shifted(delta * fraction))) low = fraction; else high = fraction }
    delta *= low
  }
  if (Math.abs(delta) < 1e-9) return { edit, delta: 0 }
  return { edit: shifted(delta), delta }
}
export function splitClips(edit: TimelineEdit, ids: string[], time: number, minimum: number, createId = () => crypto.randomUUID()) {
  const selected = new Set(linkedSelection(edit, ids))
  const splittable = all(edit).filter((c) => selected.has(c.id) && time > c.at + 1e-7 && time < endAt(c) - 1e-7)
  // Never create a near-zero linked fragment while its partner splits normally.
  if (!splittable.length || splittable.some((c) => time <= c.at + minimum || time >= endAt(c) - minimum)) return { edit, selection: ids }
  if (tracks.some((track) => edit[track].some((c) => selected.has(c.id) && time > c.at && time < endAt(c) && edit[track].some((other) => other.id !== c.id && other.lane === c.lane && time >= other.at - 1e-7 && time <= endAt(other) + 1e-7)))) return { edit, selection: ids }
  const splitIds = new Set(splittable.map((c) => c.id))
  const links = new Map<string, { left: string; right: string }>()
  for (const c of splittable) if (c.linkId && !links.has(c.linkId)) links.set(c.linkId, { left: createId(), right: createId() })
  const selection: string[] = []
  const splitTrack = (clips: Segment[]) => clips.flatMap((c) => {
    const group = c.linkId ? links.get(c.linkId) : undefined
    if (splitIds.has(c.id)) {
      const cut = c.start + time - c.at
      const right = { ...c, id: createId(), start: cut, at: time, linkId: group?.right, effects: { ...c.effects, fadeIn: 0, audioFadeIn: 0 } }
      selection.push(right.id)
      return [{ ...c, end: cut, linkId: group?.left, effects: { ...c.effects, fadeOut: 0, audioFadeOut: 0 } }, right]
    }
    if (group) {
      const right = c.at >= time - 1e-7
      if (right) selection.push(c.id)
      return [{ ...c, linkId: right ? group.right : group.left }]
    }
    return [c]
  })
  const result = pruneLinks({ ...edit, video: splitTrack(edit.video), audio: splitTrack(edit.audio) })
  if (tracks.some((track) => result.lanes[track].some((_, lane) => !validLane(result[track].filter((c) => c.lane === lane))))) return { edit, selection: ids }
  return { edit: result, selection: linkedSelection(result, selection) }
}
// Trim every linked partner by one shared source/timeline delta. Staggered edges
// stay staggered: do not force different recordings to share source IN/OUT values.
export function trimLinkedClips(edit: TimelineEdit, id: string, edge: 'start' | 'end', value: number, sourceDurations: Record<string, number>, minimum: number) {
  const reference = all(edit).find((c) => c.id === id)
  if (!reference || !Number.isFinite(value) || !Number.isFinite(minimum) || minimum <= 0) return { edit, delta: 0, limited: false }
  const ids = new Set(linkedSelection(edit, [id])), group = all(edit).filter((c) => ids.has(c.id)), requested = value - reference[edge]
  let lower = -Infinity, upper = Infinity
  for (const c of group) {
    const duration = sourceDurations[c.mediaId], keep = Math.min(minimum, length(c))
    if (!Number.isFinite(duration) || duration < c.end - 1e-7) return { edit, delta: 0, limited: true }
    if (edge === 'start') { lower = Math.max(lower, -c.start, -c.at); upper = Math.min(upper, length(c) - keep) }
    else { lower = Math.max(lower, keep - length(c)); upper = Math.min(upper, Math.max(0, duration - c.end)) }
  }
  let delta = Math.max(lower, Math.min(upper, requested))
  const changed = (amount: number) => map(edit, (c) => !ids.has(c.id) ? c : edge === 'start' ? { ...c, start: Math.max(0, c.start + amount), at: Math.max(0, c.at + amount) } : { ...c, end: c.end + amount })
  const affected = tracks.flatMap((track) => [...new Set(edit[track].filter((c) => ids.has(c.id)).map((c) => c.lane))].map((lane) => ({ track, lane })))
  const valid = (next: TimelineEdit) => affected.every(({ track, lane }) => validLane(next[track].filter((c) => c.lane === lane)))
  // Lane constraints are linear until ordering would change; clamp before a
  // nested/triple overlap or ordering reversal, never trim only one partner.
  if (!valid(changed(delta))) {
    let low = 0, high = 1
    for (let i = 0; i < 32; i++) { const fraction = (low + high) / 2; if (valid(changed(delta * fraction))) low = fraction; else high = fraction }
    delta *= low
  }
  if (Math.abs(delta) < 1e-9) return { edit, delta: 0, limited: Math.abs(requested) > 1e-7 }
  return { edit: changed(delta), delta, limited: Math.abs(delta - requested) > 1e-7 }
}
