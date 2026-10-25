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
// Clamp one shared delta for the whole selection: no overlaps, lost relative sync,
// negative video placement, or destructive overwrites. Audio can have pre-roll.
export function moveClips(edit: TimelineEdit, ids: string[], requested: number, snapDistance = 0, playhead?: number) {
  const selected = new Set(linkedSelection(edit, ids))
  if (!selected.size || !Number.isFinite(requested)) return { edit, delta: 0 }
  let min = -Infinity, max = Infinity
  for (const track of tracks) for (const c of edit[track].filter((c) => selected.has(c.id))) {
    if (track === 'video') min = Math.max(min, -c.at)
    for (const other of edit[track].filter((other) => !selected.has(other.id) && other.lane === c.lane)) {
      if (endAt(other) <= c.at + 1e-7) min = Math.max(min, endAt(other) - c.at)
      else if (other.at >= endAt(c) - 1e-7) max = Math.min(max, other.at - endAt(c))
    }
  }
  let delta = Math.max(min, Math.min(max, requested))
  const targets = [0, ...(playhead === undefined ? [] : [playhead]), ...all(edit).filter((c) => !selected.has(c.id)).flatMap((c) => [c.at, endAt(c)])]
  let nearest = snapDistance
  for (const c of all(edit).filter((c) => selected.has(c.id))) for (const edge of [c.at, endAt(c)]) for (const target of targets) {
    const candidate = target - edge, distance = Math.abs(candidate - requested)
    if (candidate >= min - 1e-7 && candidate <= max + 1e-7 && distance < nearest) { nearest = distance; delta = Math.max(min, Math.min(max, candidate)) }
  }
  if (Math.abs(delta) < 1e-9) return { edit, delta: 0 }
  return { edit: map(edit, (c) => selected.has(c.id) ? { ...c, at: c.at + delta } : c), delta }
}
export function splitClips(edit: TimelineEdit, ids: string[], time: number, minimum: number, createId = () => crypto.randomUUID()) {
  const selected = new Set(linkedSelection(edit, ids))
  const splittable = all(edit).filter((c) => selected.has(c.id) && time > c.at + 1e-7 && time < endAt(c) - 1e-7)
  if (!splittable.some((c) => time > c.at + minimum && time < endAt(c) - minimum)) return { edit, selection: ids }
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
  return { edit: result, selection: linkedSelection(result, selection) }
}
export function trimClip(edit: TimelineEdit, id: string, edge: 'start' | 'end', value: number, sourceDuration: number, minimum: number) {
  return map(edit, (clip, track) => {
    if (clip.id !== id || !Number.isFinite(value)) return clip
    const clips = ordered(edit[track].filter((c) => c.lane === clip.lane)), index = clips.findIndex((c) => c.id === id)
    if (edge === 'start') {
      const earliest = Math.max(0, index ? clip.start + endAt(clips[index - 1]) - clip.at : track === 'video' ? clip.start - clip.at : 0)
      const start = Math.max(earliest, Math.min(clip.end - minimum, value))
      return Math.abs(start - clip.start) < 1e-9 ? clip : { ...clip, start, at: clip.at + start - clip.start }
    }
    const latest = Math.min(sourceDuration, index < clips.length - 1 ? clip.start + clips[index + 1].at - clip.at : sourceDuration)
    const end = Math.max(clip.start + minimum, Math.min(latest, value))
    return Math.abs(end - clip.end) < 1e-9 ? clip : { ...clip, end }
  })
}
