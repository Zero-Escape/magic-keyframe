import path from 'node:path'
import { ordered, emptyEdit, type Segment, type TimelineEdit } from './timeline.js'
import { effectLimits } from './effects.js'
import { randomUUID } from 'node:crypto'
import { readFile, open, rename, unlink, stat } from 'node:fs/promises'
export type Project = {
  format: 'magic-keyframe-project'; version: 3
  media: { id: string; kind: 'video' | 'audio'; path: string; absolutePath?: string }[]
  edit: TimelineEdit
  view: { position: number; zoom: number; timelineHeight: number; sidebarWidth: number }
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
export function validateProject(value: unknown): Project {
  const p = structuredClone(value) as Project
  if (!p || p.format !== 'magic-keyframe-project' || ![1, 2, 3].includes(p.version)) throw new Error('Not a supported Magic Keyframe project (versions 1–3).')
  if (!Array.isArray(p.media) || p.media.length > 200 || !p.edit || !p.view) throw new Error('Invalid project structure.')
  if (Number(p.version) < 3) {
    const legacy = p as unknown as { tracks: { videoMuted: boolean; audioMuted: boolean; videoHidden: boolean }; edit: TimelineEdit & { audioOffset?: number } }
    const lanes = emptyEdit().lanes
    if (!legacy.tracks || ['videoMuted', 'audioMuted', 'videoHidden'].some((key) => typeof legacy.tracks[key as keyof typeof legacy.tracks] !== 'boolean')) throw new Error('Invalid legacy track settings.')
    lanes.video[0].muted = legacy.tracks.videoMuted; lanes.video[0].hidden = legacy.tracks.videoHidden; lanes.audio[0].muted = legacy.tracks.audioMuted
    const offset = legacy.edit.audioOffset
    if (Number(p.version) === 1 && !finite(offset)) throw new Error('Invalid legacy audio offset.')
    for (const track of ['video', 'audio'] as const) {
      if (!Array.isArray(p.edit[track])) throw new Error('Invalid legacy clips.')
      const source = p.media.find((m) => m.kind === track)
      p.edit[track] = p.edit[track].map((c) => ({ ...c, mediaId: source?.id || '', lane: 0, at: Number(p.version) === 1 ? c.start + (track === 'audio' ? offset! : 0) : c.at }))
    }
    p.edit = { video: p.edit.video, audio: p.edit.audio, lanes }; p.version = 3
  }
  const ids = new Map<string, 'video' | 'audio'>()
  for (const m of p.media) {
    if (!m || typeof m.id !== 'string' || !m.id || ids.has(m.id) || !['video', 'audio'].includes(m.kind) || typeof m.path !== 'string' || !m.path || (m.absolutePath !== undefined && typeof m.absolutePath !== 'string')) throw new Error('Invalid project media.')
    ids.set(m.id, m.kind)
  }
  const clipIds = new Set<string>()
  for (const track of ['video', 'audio'] as const) {
    const clips = p.edit[track], lanes = p.edit.lanes?.[track]
    if (!Array.isArray(clips) || clips.length > 10000 || !Array.isArray(lanes) || !lanes.length || lanes.length > 16) throw new Error('Invalid project tracks.')
    for (const lane of lanes) if (!lane || typeof lane.name !== 'string' || !lane.name || lane.name.length > 100 || typeof lane.muted !== 'boolean' || typeof lane.hidden !== 'boolean') throw new Error('Invalid track settings.')
    for (const c of clips) {
      if (!c || typeof c.id !== 'string' || !c.id || clipIds.has(c.id) || ids.get(c.mediaId) !== track || !Number.isInteger(c.lane) || c.lane < 0 || c.lane >= lanes.length || !finite(c.start) || !finite(c.end) || c.start < 0 || c.end <= c.start || !finite(c.at) || (track === 'video' && c.at < -1e-7) || (c.linkId !== undefined && (typeof c.linkId !== 'string' || !c.linkId || c.linkId.length > 200))) throw new Error('Invalid project clip.')
      if (c.effects) for (const [key, val] of Object.entries(c.effects)) {
        const limit = effectLimits[key as keyof typeof effectLimits]
        if (!limit || !finite(val) || val < limit[0] || val > limit[1]) throw new Error('Invalid clip effect.')
      }
      clipIds.add(c.id)
    }
    for (let lane = 0; lane < lanes.length; lane++) {
      const placed = ordered(clips.filter((c) => c.lane === lane))
      if (placed.some((c, i) => i > 0 && c.at < placed[i - 1].at + placed[i - 1].end - placed[i - 1].start - 1e-7)) throw new Error('Clips overlap on the same track.')
    }
  }
  for (const key of ['position', 'zoom', 'timelineHeight', 'sidebarWidth'] as const) if (!finite(p.view[key])) throw new Error('Invalid project view.')
  if (p.view.position < 0 || p.view.zoom < 100 || p.view.zoom > 4000 || p.view.timelineHeight < 220 || p.view.timelineHeight > 10000 || p.view.sidebarWidth < 220 || p.view.sidebarWidth > 560) throw new Error('Project view is outside supported limits.')
  return p
}
export async function readProject(filePath: string) {
  if ((await stat(filePath)).size > 16 * 1024 * 1024) throw new Error('Project is too large.')
  const bytes = await readFile(filePath)
  // Accept BOMs from Windows text tools without weakening project validation.
  const raw = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8').replace(/^\uFEFF/, '')
  try { return validateProject(JSON.parse(raw)) }
  catch (error) { throw new Error(`Could not read ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`) }
}
export async function writeProject(filePath: string, value: unknown) {
  const project = validateProject(value)
  const data = { ...project, media: project.media.map((m) => ({ ...m, path: path.relative(path.dirname(filePath), m.path), absolutePath: path.resolve(m.path) })) }
  const pending = `${filePath}.${randomUUID()}.tmp`
  try {
    const file = await open(pending, 'wx')
    try { await file.writeFile(JSON.stringify(data, null, 2)); await file.sync() } finally { await file.close() }
    await rename(pending, filePath)
  } catch (error) { await unlink(pending).catch(() => {}); throw error }
}
