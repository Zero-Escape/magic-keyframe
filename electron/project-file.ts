import path from 'node:path'
import { ordered, type Segment, type TimelineEdit } from './timeline.js'
import { randomUUID } from 'node:crypto'
import { readFile, open, rename, unlink, stat } from 'node:fs/promises'

export type Project = {
  format: 'magic-keyframe-project'; version: 2
  media: { id: string; kind: 'video' | 'audio'; path: string; absolutePath?: string }[]
  edit: TimelineEdit
  tracks: { videoMuted: boolean; audioMuted: boolean; videoHidden: boolean }
  view: { position: number; zoom: number; timelineHeight: number; sidebarWidth: number }
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
export function validateProject(value: unknown): Project {
  const original = value as Project & { version: number }
  if (!original || original.format !== 'magic-keyframe-project' || ![1, 2].includes(original.version)) throw new Error('Not a supported Magic Keyframe project (version 1 or 2 required).')
  // Older projects used source-time placement plus one global audio offset.
  // Upgrade in memory only; saving writes v2 and never changes a v1 file on open.
  const p = structuredClone(original) as Project
  if (Number(original.version) === 1 && original.edit) {
    const offset = (original.edit as TimelineEdit & { audioOffset: number }).audioOffset
    if (!finite(offset)) throw new Error('Invalid legacy audio offset.')
    p.version = 2
    p.edit = {
      video: Array.isArray(original.edit.video) ? original.edit.video.map((c) => ({ ...c, at: c.start })) : original.edit.video,
      audio: Array.isArray(original.edit.audio) ? original.edit.audio.map((c) => ({ ...c, at: c.start + offset })) : original.edit.audio,
    }
  }
  if (!Array.isArray(p.media) || p.media.length > 2 || !p.edit || !p.tracks || !p.view) throw new Error('Invalid project structure.')
  const ids = new Set<string>(), kinds = new Set<string>()
  for (const m of p.media) {
    if (!m || typeof m.id !== 'string' || !m.id || ids.has(m.id) || !['video', 'audio'].includes(m.kind) || kinds.has(m.kind) || typeof m.path !== 'string' || !m.path || (m.absolutePath !== undefined && typeof m.absolutePath !== 'string')) throw new Error('Invalid project media.')
    ids.add(m.id); kinds.add(m.kind)
  }
  const clipIds = new Set<string>()
  for (const track of ['video', 'audio'] as const) {
    const segments = p.edit[track]
    if (!Array.isArray(segments) || segments.length > 10000 || (!kinds.has(track) && segments.length)) throw new Error('Invalid project cuts.')
    const byPosition = ordered(segments)
    for (let i = 0; i < byPosition.length; i++) {
      const s: Segment = byPosition[i]
      if (!s || typeof s.id !== 'string' || !s.id || clipIds.has(s.id) || !finite(s.start) || !finite(s.end) || s.start < 0 || s.end <= s.start || !finite(s.at) || (track === 'video' && s.at < -1e-7) || (s.linkId !== undefined && (typeof s.linkId !== 'string' || !s.linkId || s.linkId.length > 200)) || (i > 0 && s.at < byPosition[i - 1].at + byPosition[i - 1].end - byPosition[i - 1].start - 1e-7)) throw new Error('Invalid project cut points.')
      clipIds.add(s.id)
    }
  }
  for (const key of ['videoMuted', 'audioMuted', 'videoHidden'] as const) if (typeof p.tracks[key] !== 'boolean') throw new Error('Invalid track settings.')
  for (const key of ['position', 'zoom', 'timelineHeight', 'sidebarWidth'] as const) if (!finite(p.view[key])) throw new Error('Invalid project view.')
  if (p.view.position < 0 || p.view.zoom < 100 || p.view.zoom > 4000 || p.view.timelineHeight < 220 || p.view.timelineHeight > 10000 || p.view.sidebarWidth < 220 || p.view.sidebarWidth > 560) throw new Error('Project view is outside supported limits.')
  return p
}
export async function readProject(filePath: string) {
  if ((await stat(filePath)).size > 8 * 1024 * 1024) throw new Error('Project is too large.')
  const raw = await readFile(filePath, 'utf8')
  return validateProject(JSON.parse(raw))
}
export async function writeProject(filePath: string, value: unknown) {
  const project = validateProject(value)
  const data = { ...project, media: project.media.map((m) => ({ ...m, path: path.relative(path.dirname(filePath), m.path), absolutePath: path.resolve(m.path) })) }
  const pending = `${filePath}.${randomUUID()}.tmp`
  try {
    const file = await open(pending, 'wx')
    try { await file.writeFile(JSON.stringify(data, null, 2)); await file.sync() } finally { await file.close() }
    await rename(pending, filePath)
  }
  catch (error) { await unlink(pending).catch(() => {}); throw error }
}
