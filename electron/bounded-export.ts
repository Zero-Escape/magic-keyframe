import { spawn, type ChildProcess } from 'node:child_process'
import { availableParallelism, constants, setPriority } from 'node:os'
import { mkdtemp, writeFile, rename, rm, statfs } from 'node:fs/promises'
import path from 'node:path'
import { buildStudioExport, type RenderMedia } from './studio-export.js'
import { endAt, timelineEnd, type TimelineEdit, type Segment } from './timeline.js'
import type { ExportProgress, ExportSettings } from './export-settings.js'
export type ExportTask = { id: string; canceled: boolean; child?: ChildProcess }
const canceled = (task: ExportTask) => { if (task.canceled) throw new Error('Export canceled') }
function covered(clip: Segment, video: Segment[], edit: TimelineEdit, start: number, finish: number) {
  let cursor = Math.max(start, clip.at), end = Math.min(finish, endAt(clip))
  for (const c of video.filter((c) => c.lane > clip.lane && !edit.lanes.video[c.lane].hidden && c.at < end && endAt(c) > cursor).sort((a, b) => a.at - b.at)) {
    if (c.at > cursor + 1e-7) return false
    cursor = Math.max(cursor, endAt(c)); if (cursor >= end - 1e-7) return true
  }
  return false
}
function planWindow(edit: TimelineEdit, media: RenderMedia[], start: number, duration: number, fps: number, prepared: Map<string, string>) {
  const inputs: RenderMedia[] = [], active = new Set<string>(), finish = start + duration
  for (const kind of ['video', 'audio'] as const) for (const c of edit[kind]) {
    if (c.at >= finish || endAt(c) <= start) continue
    const source = media.find((m) => m.id === c.mediaId); if (!source) continue
    const video = kind === 'video' && !edit.lanes.video[c.lane].hidden && !covered(c, edit.video, edit, start, finish)
    const audio = !edit.lanes[kind][c.lane].muted && source.audio
    if (!video && !audio) continue
    const from = Math.max(start, c.at), to = Math.min(finish, endAt(c)), preroll = Math.ceil(fps * .3) / fps
    const timing = { seek: Math.max(c.start, c.start + from - c.at - preroll), stop: Math.min(c.end, c.start + to - c.at) }, processed = prepared.get(c.id)
    if (video || audio && !processed) inputs.push({ ...source, id: c.id, video, audio: audio && !processed, ...timing })
    if (audio && processed) inputs.push({ id: `${c.id}:processed`, path: processed, video: false, audio: true, audioFor: c.id, processed: true, ...timing })
    active.add(c.id)
  }
  if (inputs.filter((m) => m.video).length > 4 || inputs.length > 12) throw new Error('This section needs too many simultaneous sources for a low-memory render. Mute/hide unused tracks or simplify the layered section.')
  return { media: inputs, edit: { ...edit, video: edit.video.map((c) => active.has(c.id) ? { ...c, mediaId: c.id } : c), audio: edit.audio.map((c) => active.has(c.id) ? { ...c, mediaId: c.id } : c) } }
}
export async function encode(binary: string, args: string[], task: ExportTask, onTime: (seconds: number, warning?: string) => void) {
  canceled(task)
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ['-hide_banner', '-nostdin', '-v', 'error', '-progress', 'pipe:1', '-nostats', ...args], { windowsHide: true }); task.child = child
    let pending = '', errors = '', time = 0, warning: string | undefined
    if (child.pid) { try { setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL) } catch { warning = 'OS priority could not be lowered; thread and piece limits remain active.' } }
    const heartbeat = setInterval(() => onTime(time, warning), 1000)
    child.stdout.on('data', (chunk: Buffer) => {
      pending += chunk.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop() || ''
      for (const line of lines) if (line.startsWith('out_time_us=')) { const next = Number(line.slice(12)) / 1e6; if (Number.isFinite(next)) { time = Math.max(0, next); onTime(time, warning) } }
    })
    child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-20000) })
    child.on('error', (error) => { clearInterval(heartbeat); reject(error) })
    child.on('close', (code) => { clearInterval(heartbeat); task.child = undefined; task.canceled ? reject(new Error('Export canceled')) : code === 0 ? resolve() : reject(new Error(errors || `Encoder exited ${code}`)) })
  })
}
export async function renderBounded(binary: string, edit: TimelineEdit, media: RenderMedia[], settings: ExportSettings, sourceFps: number, output: string, task: ExportTask, progress: (event: ExportProgress) => void, prepared = new Map<string, string>()) {
  const fps = settings.fps || sourceFps, total = timelineEnd(edit)
  const firstFrame = Math.floor(settings.rangeStart * fps + 1e-6), lastFrame = Math.ceil(Math.min(total, settings.rangeEnd || total) * fps - 1e-6), frames = lastFrame - firstFrame, duration = frames / fps
  if (settings.rangeStart >= total || settings.rangeEnd && settings.rangeEnd > total + 1e-6) throw new Error('Export range must be inside the timeline.')
  if (!Number.isFinite(fps) || fps <= 0 || fps > 60 || frames <= 0) throw new Error('Unsupported frame rate or empty timeline.')
  const started = Date.now(), elapsed = () => (Date.now() - started) / 1000
  const width = settings.resolution === '1080p' ? 1920 : 3840, height = settings.resolution === '1080p' ? 1080 : 2160
  const threads = Math.max(1, Math.min(settings.resource === 'low' ? 2 : 4, availableParallelism() - 2)), chunkFrames = Math.max(1, Math.round(fps * (settings.resource === 'low' ? 2 : 4)))
  const cutFrames = new Set<number>([lastFrame])
  for (const c of [...edit.video, ...edit.audio]) for (const point of [c.at, endAt(c)]) { const frame = Math.ceil(point * fps - 1e-6); if (frame > firstFrame && frame < lastFrame) cutFrames.add(frame) }
  const cuts = [...cutFrames].sort((a, b) => a - b), pieces: { start: number; frames: number }[] = []
  let cursor = firstFrame, cut = 0
  while (cursor < lastFrame) { while (cuts[cut] <= cursor) cut++; const finish = Math.min(lastFrame, cursor + chunkFrames, cuts[cut] ?? lastFrame); pieces.push({ start: cursor / fps, frames: finish - cursor }); cursor = finish }
  const required = duration * (settings.maxMbps * 125000 * 2 + 192000 + settings.audioKbps * 125) * 1.1 + 512 * 1024 ** 2
  const disk = await statfs(path.dirname(output)); if (disk.bavail * disk.bsize < required) throw new Error(`Not enough free destination disk space for a bounded render. Allow approximately ${(required / 1024 ** 3).toFixed(1)} GB for pieces plus final output, or lower resolution/bitrate.`)
  canceled(task)
  const folder = await mkdtemp(path.join(path.dirname(output), '.mk-render-')), filterPath = path.join(folder, 'filters.txt'), pendingOutput = path.join(folder, 'delivery.mp4')
  let encoder = settings.encoder === 'cpu' ? 'cpu' : 'nvidia', pieceNumber = 0, encoderWarning = '', keepFolder = false
  try {
    for (const piece of pieces) {
      canceled(task); const span = piece.frames / fps, plan = planWindow(edit, media, piece.start, span, fps, prepared), filename = `piece-${String(pieceNumber).padStart(6, '0')}.mkv`
      await writeFile(filterPath, buildStudioExport(plan.edit, plan.media, width, height, fps, { start: piece.start, duration: span }))
      const common = ['-y', '-filter_threads', '1', '-filter_complex_threads', '1', ...plan.media.flatMap((m) => ['-threads', '1', '-thread_queue_size', '4', '-ss', (m.seek || 0).toFixed(8), '-t', Math.max(.001, m.stop! - m.seek!).toFixed(8), '-i', m.path]), '-filter_complex_script', filterPath, '-map', '[vout]', '-map', '[aout]']
      const tail = ['-frames:v', String(piece.frames), '-threads:v', String(threads), '-threads:a', '1', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level:v', settings.resolution === '2160p' ? fps > 30 ? '5.2' : '5.1' : fps > 30 ? '4.2' : '4.1', '-g', String(Math.round(fps * 2)), '-bf', '0', '-maxrate', `${settings.maxMbps}M`, '-bufsize', `${settings.maxMbps * 2}M`, '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-max_muxing_queue_size', '128', path.join(folder, filename)]
      const onTime = (time: number, warning?: string) => { const rendered = Math.min(duration, piece.start - firstFrame / fps + Math.min(span, time)), ratio = rendered / duration; progress({ id: task.id, phase: 'rendering', percent: Math.min(99.9, ratio * 100), elapsed: elapsed(), etaSeconds: ratio > .005 ? elapsed() * (1 - ratio) / ratio : undefined, message: `Rendering piece ${pieceNumber + 1} of ${pieces.length}`, piece: pieceNumber + 1, pieces: pieces.length, encoder, warning: warning || encoderWarning || undefined }) }
      onTime(0)
      try { await encode(binary, [...common, ...(encoder === 'nvidia' ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-cq', String(settings.quality), '-b:v', '0', '-rc-lookahead', '0', '-surfaces', '4', '-delay', '0'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(settings.quality), '-x264-params', 'rc-lookahead=8:sync-lookahead=0:mbtree=0']), ...tail], task, onTime) }
      catch (error) {
        if (task.canceled || settings.encoder !== 'auto' || encoder !== 'nvidia' || pieceNumber !== 0 || !/cannot load (?:nvcuda|nvencodeapi|libcuda|libnvidia-encode)|no (?:capable|nvenc capable) devices|driver does not support|required nvenc|minimum required nvidia|unknown encoder.*nvenc|no device available|unsupported device/i.test(String(error))) throw error
        encoder = 'cpu'; encoderWarning = 'NVIDIA encoding unavailable; using limited-thread CPU encoding.'; onTime(0)
        await encode(binary, [...common, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(settings.quality), '-x264-params', 'rc-lookahead=8:sync-lookahead=0:mbtree=0', ...tail], task, onTime)
      }
      pieceNumber++
    }
    canceled(task)
    await writeFile(path.join(folder, 'concat.txt'), pieces.map((p, i) => `file 'piece-${String(i).padStart(6, '0')}.mkv'\nduration ${(p.frames / fps).toFixed(9)}`).join('\n'))
    const finalizeStart = Date.now()
    progress({ id: task.id, phase: 'finalizing', percent: 0, elapsed: elapsed(), message: 'Pieces rendered. Encoding delivery audio and finalizing MP4…', encoder })
    await encode(binary, ['-y', '-threads', '1', '-f', 'concat', '-safe', '0', '-i', path.join(folder, 'concat.txt'), '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af', 'asetpts=N/SR/TB', '-c:a', 'aac', '-threads:a', '1', '-b:a', `${settings.audioKbps}k`, '-ar', '48000', '-movflags', '+faststart', '-max_muxing_queue_size', '128', pendingOutput], task, (time, warning) => { const ratio = Math.min(.999, time / duration); progress({ id: task.id, phase: 'finalizing', percent: ratio * 100, elapsed: elapsed(), etaSeconds: ratio > .01 && ratio < .99 ? (Date.now() - finalizeStart) / 1000 * (1 - ratio) / ratio : undefined, message: ratio >= .99 ? 'Finishing MP4 index and disk writes…' : 'Encoding delivery audio and assembling MP4 (video is stream-copied)…', encoder, warning: warning || encoderWarning || undefined }) })
    canceled(task)
    try { await rename(pendingOutput, output) }
    catch {
      const recovered = path.join(path.dirname(output), `${path.basename(output, '.mp4')}-recovered-${Date.now()}.mp4`)
      try { await rename(pendingOutput, recovered); output = recovered; encoderWarning = 'Original destination was locked. Saved a separate recovered MP4 instead.' }
      catch { keepFolder = true; throw new Error(`The render is complete but Windows could not move it. Your finished file is preserved at: ${pendingOutput}`) }
    }
    progress({ id: task.id, phase: 'done', percent: 100, elapsed: elapsed(), message: `Export saved: ${output}`, encoder, warning: encoderWarning || undefined })
    return output
  } finally { if (!keepFolder) await rm(folder, { recursive: true, force: true }).catch(() => {}) }
}
