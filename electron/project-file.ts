import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, open, rename, unlink, stat } from 'node:fs/promises'

export type Segment = { id: string; start: number; end: number }
export type Project = {
  format: 'magic-keyframe-project'; version: 1
  media: { id: string; kind: 'video' | 'audio'; path: string; absolutePath?: string }[]
  edit: { video: Segment[]; audio: Segment[]; audioOffset: number }
  tracks: { videoMuted: boolean; audioMuted: boolean; videoHidden: boolean }
  view: { position: number; zoom: number; timelineHeight: number; sidebarWidth: number }
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
export function validateProject(value: unknown): Project {
  const p = value as Project
  if (!p || p.format !== 'magic-keyframe-project' || p.version !== 1) throw new Error('Not a supported Magic Keyframe project (version 1 required).')
  if (!Array.isArray(p.media) || p.media.length > 2 || !p.edit || !p.tracks || !p.view) throw new Error('Invalid project structure.')
  const ids = new Set<string>(), kinds = new Set<string>()
  for (const m of p.media) {
    if (!m || typeof m.id !== 'string' || !m.id || ids.has(m.id) || !['video', 'audio'].includes(m.kind) || kinds.has(m.kind) || typeof m.path !== 'string' || !m.path || (m.absolutePath !== undefined && typeof m.absolutePath !== 'string')) throw new Error('Invalid project media.')
    ids.add(m.id); kinds.add(m.kind)
  }
  if (!finite(p.edit.audioOffset)) throw new Error('Invalid audio offset.')
  for (const track of ['video', 'audio'] as const) {
    const segments = p.edit[track], segmentIds = new Set<string>()
    if (!Array.isArray(segments) || segments.length > 10000 || (!kinds.has(track) && segments.length)) throw new Error('Invalid project cuts.')
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]
      if (!s || typeof s.id !== 'string' || !s.id || segmentIds.has(s.id) || !finite(s.start) || !finite(s.end) || s.start < 0 || s.end <= s.start || (i > 0 && s.start < segments[i - 1].end)) throw new Error('Invalid project cut points.')
      segmentIds.add(s.id)
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
