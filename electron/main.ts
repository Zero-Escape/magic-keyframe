import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { constants, setPriority } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, rename, stat, unlink, readFile, writeFile, statfs } from 'node:fs/promises'
import { readProject, writeProject, validateProject, type Project } from './project-file.js'
import { analyzeWaveform, audioThumbnail, type WaveformData } from './waveform.js'
import packagedFfmpegStaticPath from 'ffmpeg-static'
import { type RenderMedia } from './studio-export.js'
import { renderBounded, encode, type ExportTask } from './bounded-export.js'
import { validateExportSettings, type ExportSettings, type ExportProgress } from './export-settings.js'
import { effects, effectLimits, audioProcessing, type ClipEffects } from './effects.js'
import { autosave, recoveryList, discardRecovery, recoveryInfo } from './recovery.js'
import { decodeEnvelope, findSync } from './sync-engine.js'
import { associateProjects } from './association.js'

const packagedFfmpegPath = process.platform === 'win32'
  ? path.join(app.getAppPath(), 'assets', 'ffmpeg-win64.exe')
  : packagedFfmpegStaticPath

const packagedFfprobePath: string = require('ffprobe-static').path

// Preserve existing proxy caches across the product rename.
app.setPath('userData', path.join(app.getPath('appData'), 'magic-key'))
app.setName('Magic Keyframe')

const isDev = !app.isPackaged && process.argv.includes('--dev')
const unpackedPath = (binaryPath: string) => app.isPackaged ? binaryPath.replace('app.asar', 'app.asar.unpacked') : binaryPath

type ProbeStream = {
  codec_type?: 'video' | 'audio'; codec_name?: string; profile?: string
  width?: number; height?: number; avg_frame_rate?: string; sample_rate?: string
  channels?: number; pix_fmt?: string; disposition?: { attached_pic?: number }
}
type ProbeResult = {
  format?: { duration?: string; bit_rate?: string; format_long_name?: string }
  streams?: ProbeStream[]
}

function runProcess(executable: string, args: string[], stderrResult = false, task?: ExportTask): Promise<Buffer> {
  if (task?.canceled) return Promise.reject(new Error('Audio measurement canceled'))
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...(executable === unpackedPath(packagedFfmpegPath!) ? ['-nostdin', '-threads', '1', '-filter_threads', '1'] : []), ...args], { windowsHide: true })
    if (task) task.child = child
    if (child.pid) { try { setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* Thread limits still apply. */ } }
    let output = Buffer.alloc(0), errors = ''
    child.stdout.on('data', (chunk: Buffer) => { output = Buffer.concat([output, chunk]); if (output.length > 16 * 1024 * 1024) { child.kill(); reject(new Error('Media metadata exceeded the size limit.')) } })
    child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-64000) })
    child.on('error', reject)
    child.on('close', (code) => { if (task) task.child = undefined; task?.canceled ? reject(new Error('Audio measurement canceled')) : code === 0 ? resolve(stderrResult ? Buffer.from(errors) : output) : reject(new Error(errors || `Media process exited with ${code}`)) })
  })
}

async function fileExists(filePath: string) {
  try { await access(filePath); return true } catch { return false }
}

const jobPools = { video: { active: 0, waiting: [] as (() => void)[] }, audio: { active: 0, waiting: [] as (() => void)[] } }
async function acquireSlot(kind: 'video' | 'audio') {
  const pool = jobPools[kind]
  if (pool.active < 1) pool.active++
  else await new Promise<void>((resolve) => pool.waiting.push(resolve))
  return () => { const next = pool.waiting.shift(); if (next) next(); else pool.active-- }
}
const proxyJobs = new Map<string, Promise<{ path: string; url: string }>>()
type ProxyTask = { canceled: boolean; child?: ReturnType<typeof spawn> }
const proxyTasks = new Map<string, ProxyTask>()
function proxyProgress(filePath: string, status: 'queued' | 'running' | 'ready' | 'error' | 'canceled', percent: number, etaSeconds?: number) {
  mainWindow?.webContents.send('media:proxy-progress', { path: filePath, status, percent, etaSeconds })
}
async function runProxyProcess(filePath: string, args: string[], duration: number, task: ProxyTask) {
  if (task.canceled) throw new Error('Proxy canceled')
  const started = Date.now()
  return new Promise<void>((resolve, reject) => {
    const child = spawn(unpackedPath(packagedFfmpegPath!), ['-progress', 'pipe:1', '-nostats', ...args], { windowsHide: true }); task.child = child
    if (child.pid) { try { setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* Best effort. */ } }
    let text = '', errors = ''
    proxyProgress(filePath, 'running', 0)
    child.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString(); const lines = text.split(/\r?\n/); text = lines.pop() || ''
      for (const line of lines) if (line.startsWith('out_time_us=')) {
        const seconds = Number(line.slice(12)) / 1e6
        if (!Number.isFinite(seconds)) continue
        const ratio = duration > 0 ? Math.max(0, Math.min(.99, seconds / duration)) : 0
        proxyProgress(filePath, 'running', ratio * 100, ratio > .01 ? (Date.now() - started) / 1000 * (1 - ratio) / ratio : undefined)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-16000) })
    child.on('error', reject)
    child.on('close', (code) => { task.child = undefined; task.canceled ? reject(new Error('Proxy canceled')) : code === 0 ? resolve() : reject(new Error(errors || `Proxy encoder exited ${code}`)) })
  })
}
function generateProxy(filePath: string) {
  let pending = proxyJobs.get(filePath)
  if (!pending) {
    const task: ProxyTask = { canceled: false }; proxyTasks.set(filePath, task); proxyProgress(filePath, 'queued', 0)
    pending = buildProxy(filePath, task).catch((error) => { proxyProgress(filePath, task.canceled ? 'canceled' : 'error', 0); throw error }).finally(() => { proxyJobs.delete(filePath); proxyTasks.delete(filePath) })
    proxyJobs.set(filePath, pending)
  }
  return pending
}
async function buildProxy(filePath: string, task: ProxyTask) {
  if (!packagedFfmpegPath) throw new Error('FFmpeg is unavailable')
  const proxyFolder = path.join(app.getPath('userData'), 'proxies')
  await mkdir(proxyFolder, { recursive: true })
  const source = await stat(filePath)
  const key = createHash('sha1').update(filePath).update(String(source.size)).update(String(source.mtimeMs)).digest('hex').slice(0, 16)
  const outputPath = path.join(proxyFolder, `${key}-preview720p-v2.mp4`)
  if (!await fileExists(outputPath)) {
    const duration = (await inspectMedia(filePath)).duration, release = await acquireSlot('video')
    const pendingPath = path.join(proxyFolder, `${key}-${process.pid}-${Date.now()}.mp4`)
    const input = ['-y', '-nostdin', '-threads', '1', '-filter_threads', '1', '-v', 'error', '-i', filePath, '-map', '0:v:0', '-an', '-vf', 'scale=-2:720,format=yuv420p']
    const output = ['-threads:v', '2', '-pix_fmt', 'yuv420p', '-g', '15', '-bf', '0', '-movflags', '+faststart', pendingPath]
    try {
      if (task.canceled) throw new Error('Proxy canceled')
      try { await runProxyProcess(filePath, [...input, '-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '25', ...output], duration, task) }
      catch (error) { if (task.canceled || !/cannot load (?:nvcuda|nvencodeapi|libcuda|libnvidia-encode)|no (?:capable|nvenc capable) devices|driver does not support|required nvenc|minimum required nvidia|unknown encoder.*nvenc|no device available|unsupported device/i.test(String(error))) throw error; await runProxyProcess(filePath, [...input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', ...output], duration, task) }
      if (task.canceled) throw new Error('Proxy canceled')
      await rename(pendingPath, outputPath)
    } catch (error) { await unlink(pendingPath).catch(() => {}); throw error } finally { release() }
  }
  if (task.canceled) throw new Error('Proxy canceled')
  proxyProgress(filePath, 'ready', 100)
  return { path: outputPath, url: pathToFileURL(outputPath).toString() }
}

type ExportRequest = { id: string; project: Project; settings: ExportSettings }
let lastExportPath: string | undefined
let activeExport: ExportTask | undefined
async function exportVideo(request: ExportRequest) {
  if (activeExport) throw new Error('An export is already running.')
  if (!packagedFfmpegPath) throw new Error('FFmpeg is unavailable')
  if (typeof request.id !== 'string' || !request.id || request.id.length > 100) throw new Error('Invalid export job ID.')
  const task: ExportTask = { id: request.id, canceled: false }; activeExport = task
  const started = Date.now(), emit = (event: ExportProgress) => mainWindow?.webContents.send('media:export-progress', event)
  try {
    for (const proxy of proxyTasks.values()) { proxy.canceled = true; proxy.child?.kill() }
    for (const audio of audioTasks.values()) { audio.canceled = true; audio.child?.kill() }
    await Promise.allSettled([...proxyJobs.values(), ...audioJobs.values()])
    const settings = validateExportSettings(request.settings), project = validateProject(request.project), usedIds = new Set([...project.edit.video, ...project.edit.audio].map((c) => c.mediaId))
    if (!project.edit.video.length) throw new Error('Add at least one video clip before exporting.')
    emit({ id: task.id, phase: 'preparing', elapsed: 0, message: 'Checking sources and preparing export…' })
    const media: RenderMedia[] = []; let fps = 29.97
    for (const item of project.media.filter((m) => usedIds.has(m.id))) {
      if (task.canceled) return { canceled: true }
      emit({ id: task.id, phase: 'preparing', elapsed: (Date.now() - started) / 1000, message: `Checking source ${media.length + 1}: ${path.basename(item.path)}` })
      const meta = await inspectMedia(item.path)
      if (item.kind === 'video' && !meta.video) throw new Error(`No video in ${path.basename(item.path)}`)
      if (project.edit[item.kind].some((c) => c.mediaId === item.id && c.end > meta.duration + .05)) throw new Error(`Invalid source range for ${path.basename(item.path)}`)
      if (media.every((m) => !m.video) && meta.video?.fps) fps = meta.video.fps
      media.push({ id: item.id, path: item.path, audio: !!meta.audio, video: !!meta.video })
    }
    if (task.canceled) return { canceled: true }
    const result = await dialog.showSaveDialog(mainWindow!, { title: 'Export delivery MP4', defaultPath: path.join(app.getPath('videos'), 'Magic-Keyframe-Export.mp4'), filters: [{ name: 'MP4 video', extensions: ['mp4'] }] })
    if (result.canceled || !result.filePath || task.canceled) return { canceled: true }
    const output = result.filePath.toLowerCase().endsWith('.mp4') ? result.filePath : `${result.filePath}.mp4`
    if (project.media.some((m) => path.resolve(m.path).toLowerCase() === path.resolve(output).toLowerCase())) throw new Error('Export cannot overwrite source media.')
    const prepared = new Map<string, string>()
    const clips = (['video', 'audio'] as const).flatMap((kind) => project.edit[kind].filter((c) => !project.edit.lanes[kind][c.lane].muted && c.at < (settings.rangeEnd || Infinity) && c.at + c.end - c.start > settings.rangeStart && media.find((m) => m.id === c.mediaId)?.audio && audioProcessing(effects(c.effects)).length))
    for (let i = 0; i < clips.length; i++) {
      if (task.canceled) return { canceled: true }
      const c = clips[i], source = media.find((m) => m.id === c.mediaId)!
      emit({ id: task.id, phase: 'preparing', elapsed: (Date.now() - started) / 1000, message: `Preparing continuous audio ${i + 1}/${clips.length}: ${path.basename(source.path)}` })
      const audio = await audioPreview(source.path, c.effects, task, (seconds, duration) => emit({ id: task.id, phase: 'preparing', percent: Math.min(99.9, (i + Math.min(1, seconds / duration)) / clips.length * 100), elapsed: (Date.now() - started) / 1000, message: `Preparing continuous audio ${i + 1}/${clips.length}: ${path.basename(source.path)}` }))
      prepared.set(c.id, audio.path)
    }
    const saved = await renderBounded(unpackedPath(packagedFfmpegPath), project.edit, media, settings, fps, output, task, emit, prepared)
    lastExportPath = saved
    return { canceled: false, path: saved }
  } catch (error) {
    const message = task.canceled ? 'Export canceled. Temporary render files were cleaned up.' : String(error)
    emit({ id: task.id, phase: task.canceled ? 'canceled' : 'error', elapsed: (Date.now() - started) / 1000, message })
    if (task.canceled) return { canceled: true }
    throw error
  } finally { activeExport = undefined }
}
const audioTasks = new Map<string, ExportTask>()
const audioJobs = new Map<string, Promise<{ url: string; path: string }>>()
function validatedAudio(value?: Partial<ClipEffects>) {
  const e = effects(value)
  for (const key of ['vocal', 'noise', 'compression', 'leveling', 'gainDb'] as const) {
    const [min, max] = effectLimits[key]
    if (!Number.isFinite(e[key]) || e[key] < min || e[key] > max) throw new Error('Invalid audio processing settings.')
  }
  return e
}
async function audioPreview(filePath: string, value?: Partial<ClipEffects>, task?: ExportTask, onTime?: (seconds: number, duration: number) => void) {
  if (!packagedFfmpegPath) throw new Error('FFmpeg is unavailable')
  const e = validatedAudio(value), fx = audioProcessing(e), lossless = fx.length > 0
  const source = await stat(filePath), folder = path.join(app.getPath('userData'), lossless ? 'audio-processed-v2' : 'audio-preview-v1')
  const key = createHash('sha1').update(filePath).update(`${source.size}-${source.mtimeMs}-${e.vocal}-${e.noise}-${fx.join(',')}`).digest('hex')
  let job = audioJobs.get(key)
  if (!job) {
    const audioTask = task || { id: key, canceled: false }; audioTasks.set(key, audioTask)
    job = (async () => {
      await mkdir(folder, { recursive: true })
      const output = path.join(folder, `${key}.${lossless ? 'wav' : 'm4a'}`)
      if (!await fileExists(output)) {
        const release = await acquireSlot('audio'), pending = `${output}.${process.pid}.${lossless ? 'wav' : 'm4a'}`
        try {
          if (audioTask.canceled) throw new Error('Audio preparation canceled')
          const duration = (await inspectMedia(filePath)).duration
          const disk = await statfs(folder), needed = duration * (lossless ? 384000 : 24000) + 128 * 1024 ** 2
          if (disk.bavail * disk.bsize < needed) throw new Error('Not enough space on the system drive for the audio cache. Free space or reduce audio processing.')
          await encode(unpackedPath(packagedFfmpegPath!), ['-y', '-threads', '1', '-filter_threads', '1', '-i', filePath, '-map', '0:a:0', '-vn', ...(fx.length ? ['-af', fx.join(',')] : []), '-ar', '48000', '-ac', '2', '-threads:a', '1', ...(lossless ? ['-c:a', 'pcm_f32le', '-rf64', 'auto'] : ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']), pending], audioTask, (time) => onTime?.(time, Math.max(.001, duration)))
          if (audioTask.canceled) throw new Error('Audio preparation canceled')
          await rename(pending, output)
        } catch (error) { await unlink(pending).catch(() => {}); throw error } finally { release() }
      }
      return { path: output, url: pathToFileURL(output).toString() }
    })().finally(() => { audioJobs.delete(key); audioTasks.delete(key) })
    audioJobs.set(key, job)
  }
  return job
}
async function measureAudio(filePath: string, start: number, end: number, value?: Partial<ClipEffects>) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('Invalid measurement range.')
  if (activeExport) throw new Error('Wait until export finishes before measuring audio.')
  const e = validatedAudio(value), prepared = audioProcessing(e).length ? await audioPreview(filePath, e) : { path: filePath }
  const measurement: ExportTask = { id: `measure-${randomUUID()}`, canceled: false }; audioTasks.set(measurement.id, measurement)
  const release = await acquireSlot('audio')
  try {
    const result = await runProcess(unpackedPath(packagedFfmpegPath!), ['-hide_banner', '-v', 'info', '-ss', String(start), '-t', String(end - start), '-i', prepared.path, '-map', '0:a:0', '-vn', '-af', `volume=${10 ** (e.gainDb / 20)},loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json`, '-ar', '48000', '-f', 'null', '-'], true, measurement)
    const match = result.toString().match(/\{[^{}]*"input_i"[^{}]*\}/)
    if (!match) throw new Error('No loudness reading was returned.')
    const stats = JSON.parse(match[0]), integrated = Number(stats.input_i), peak = Number(stats.input_tp), range = Number(stats.input_lra)
    if (![integrated, peak, range].every(Number.isFinite)) throw new Error('This section is silent or too short to measure. Choose a longer section with sound.')
    const loudnessGain = -16 - integrated, peakGain = -1.5 - peak, adjustment = Math.min(loudnessGain, peakGain)
    return { integrated, peak, range, gainDb: Math.max(-60, Math.min(18, e.gainDb + adjustment)), peakLimited: peakGain < loudnessGain }
  } finally { audioTasks.delete(measurement.id); release() }
}

function frameRate(value?: string) {
  if (!value) return undefined
  const [numerator, denominator = 1] = value.split('/').map(Number)
  return denominator ? numerator / denominator : undefined
}

async function inspectMedia(filePath: string) {
  const output = await runProcess(unpackedPath(packagedFfprobePath), [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ])
  const probe = JSON.parse(output.toString()) as ProbeResult
  const video = probe.streams?.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio')
  return {
    duration: Number(probe.format?.duration || 0),
    bitRate: Number(probe.format?.bit_rate || 0),
    container: probe.format?.format_long_name,
    video: video ? { codec: video.codec_name, profile: video.profile, width: video.width, height: video.height, fps: frameRate(video.avg_frame_rate), pixelFormat: video.pix_fmt } : undefined,
    audio: audio ? { codec: audio.codec_name, sampleRate: Number(audio.sample_rate || 0), channels: audio.channels } : undefined,
  }
}

async function mediaVisuals(filePath: string, metadata: Awaited<ReturnType<typeof inspectMedia>>) {
  if (!packagedFfmpegPath) throw new Error('FFmpeg is unavailable')
  const folder = path.join(app.getPath('userData'), 'analysis-v2')
  await mkdir(folder, { recursive: true })
  const source = await stat(filePath)
  const key = createHash('sha1').update(filePath).update(String(source.size)).update(String(source.mtimeMs)).digest('hex')
  let waveform: WaveformData | undefined
  if (metadata.audio) {
    const cache = path.join(folder, `${key}.json`)
    try { waveform = JSON.parse(await readFile(cache, 'utf8')) }
    catch {
      waveform = await analyzeWaveform(unpackedPath(packagedFfmpegPath), filePath, metadata.audio.channels || 1)
      await writeFile(cache, JSON.stringify(waveform)).catch(() => {})
    }
  }
  let thumbnail: string | undefined
  if (metadata.video) {
    const target = path.join(folder, `${key}.jpg`)
    if (!await fileExists(target)) {
      const pending = `${target}.${process.pid}.${Date.now()}.jpg`
      try {
        await runProcess(unpackedPath(packagedFfmpegPath), ['-y', '-v', 'error', '-ss', String(Math.min(1, metadata.duration / 10)), '-i', filePath, '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=240:-2', '-q:v', '4', pending])
        await rename(pending, target)
      } catch { await unlink(pending).catch(() => {}) }
    }
    if (await fileExists(target)) thumbnail = pathToFileURL(target).toString()
  } else if (waveform) thumbnail = audioThumbnail(waveform)
  return { waveform, thumbnail }
}

let mainWindow: BrowserWindow | null = null
let projectDirty = false
let rendererReady = false
let allowClose = false
let pendingProject = process.argv.find((arg) => arg.toLowerCase().endsWith('.mkproj'))
function sendCommand(command: string, filePath?: string) { mainWindow?.webContents.send('project:command', command, filePath) }
function requestProject(filePath: string) {
  if (rendererReady) sendCommand('open', filePath)
  else pendingProject = filePath
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show(); mainWindow?.focus()
}
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', (_event, argv) => {
  const file = argv.find((arg) => arg.toLowerCase().endsWith('.mkproj'))
  if (file) requestProject(file)
  else { mainWindow?.show(); mainWindow?.focus() }
})
app.on('open-file', (event, filePath) => { event.preventDefault(); requestProject(filePath) })

function createWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 930,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#090a0d',
    titleBarStyle: 'hiddenInset',
    title: 'Magic Keyframe',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow = window; rendererReady = false; allowClose = false; projectDirty = false
  window.on('close', (event) => {
    if (projectDirty && !allowClose) { event.preventDefault(); sendCommand('close') }
  })
  window.on('closed', () => { mainWindow = null; rendererReady = false })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [
      { label: 'New project', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('new') },
      { label: 'Open project…', accelerator: 'CmdOrCtrl+O', click: () => sendCommand('open') },
      { label: 'Save project', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('save') },
      { label: 'Save project as…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('saveAs') },
      { type: 'separator' },
      { label: 'Associate .mkproj files with this app…', enabled: process.platform === 'win32' && app.isPackaged, click: async () => {
        try {
          await associateProjects(process.execPath)
          await dialog.showMessageBox(mainWindow!, { type: 'info', title: 'Project file association', message: 'Registered this Magic Keyframe location for .mkproj files.', detail: 'If Windows still asks, right-click a .mkproj → Open with → Choose another app → Choose an app on your PC, select this Magic Keyframe.exe, then choose Always. Keep this folder in place. Run this action again after moving/updating the portable app.' })
        } catch (error) { dialog.showErrorBox('Could not associate project files', String(error)) }
      } },
      { role: 'close' },
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo edit', accelerator: 'CmdOrCtrl+Z', click: () => sendCommand('undo') },
      { label: 'Redo edit', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendCommand('redo') },
      { label: 'Redo edit', accelerator: 'Ctrl+Y', click: () => sendCommand('redo') },
      { type: 'separator' },
      { label: 'Link clips', accelerator: 'CmdOrCtrl+L', click: () => sendCommand('link') },
      { label: 'Unlink clips', accelerator: 'CmdOrCtrl+Shift+L', click: () => sendCommand('unlink') },
      { label: 'Split selected clips', accelerator: 'CmdOrCtrl+B', click: () => sendCommand('split') },
      { label: 'Select all clips', accelerator: 'CmdOrCtrl+A', click: () => sendCommand('selectAll') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
    ] },
    { role: 'viewMenu' }, { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'About Magic Keyframe', click: () => { void dialog.showMessageBox(mainWindow!, { type: 'info', title: 'About Magic Keyframe', message: `Magic Keyframe ${app.getVersion()}`, detail: `Running from:\n${process.execPath}` }) } }] },
  ]))
  if (isDev) window.loadURL('http://localhost:5173')
  else window.loadFile(path.join(__dirname, '../dist/index.html'))
}

async function importMediaPaths(paths: string[]) {
  if (!Array.isArray(paths) || paths.length > 100 || paths.some((filePath) => typeof filePath !== 'string')) throw new Error('Invalid media drop')
  const supported = new Set(['.mp4', '.mov', '.mxf', '.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.aif', '.aiff'])
  const files = [...new Set(paths)].filter((filePath) => supported.has(path.extname(filePath).toLowerCase()))
  if (!files.length) throw new Error('Choose supported video or audio files (MP4, MOV, MXF, WAV, MP3, M4A, AAC, FLAC, OGG or AIFF). Folders cannot be imported.')
  const imported = []
  for (const filePath of files) {
    if (!(await stat(filePath)).isFile()) throw new Error('Drop media files, not folders')
    const metadata = await inspectMedia(filePath)
    if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) throw new Error(`Could not determine media duration: ${path.basename(filePath)}`)
    if (!metadata.video && !metadata.audio) throw new Error(`No supported media streams in ${path.basename(filePath)}`)
    const [visuals, audio] = await Promise.all([mediaVisuals(filePath, metadata), metadata.audio ? audioPreview(filePath) : Promise.resolve(undefined)])
    imported.push({ path: filePath, url: pathToFileURL(filePath).toString(), name: path.basename(filePath), metadata, audioUrl: audio?.url, ...visuals })
  }
  return imported
}

ipcMain.handle('media:import', (_event, paths: string[]) => importMediaPaths(paths))
ipcMain.handle('media:choose', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Add media to Magic Keyframe',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video and audio', extensions: ['mp4', 'mov', 'mxf', 'wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'aif', 'aiff'] },
    ],
  })
  if (result.canceled) return []
  return importMediaPaths(result.filePaths)
})

ipcMain.handle('media:proxy', (_event, filePath: string) => generateProxy(filePath))
ipcMain.handle('media:cancel-proxies', async () => {
  for (const task of proxyTasks.values()) { task.canceled = true; task.child?.kill() }
  await Promise.allSettled([...proxyJobs.values()])
})
ipcMain.handle('media:show-export', () => { if (lastExportPath) shell.showItemInFolder(lastExportPath) })
ipcMain.handle('media:export', (_event, request: ExportRequest) => exportVideo(request))
ipcMain.handle('media:cancel-export', (_event, id: string) => { if (activeExport?.id === id) { activeExport.canceled = true; activeExport.child?.kill() } })

ipcMain.on('project:dirty', (_event, dirty: boolean) => { projectDirty = Boolean(dirty) })
ipcMain.on('project:ready', () => { rendererReady = true; if (pendingProject) { const file = pendingProject; pendingProject = undefined; sendCommand('open', file) } })
ipcMain.on('project:close', () => { allowClose = true; mainWindow?.close() })
ipcMain.handle('project:confirm', async () => {
  const result = await dialog.showMessageBox(mainWindow!, { type: 'question', title: 'Unsaved project', message: 'Save changes to this project?', buttons: ['Save', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true })
  return ['save', 'discard', 'cancel'][result.response]
})
ipcMain.handle('project:save', async (_event, project: Project, currentPath?: string) => {
  let filePath = currentPath
  if (!filePath) {
    const result = await dialog.showSaveDialog(mainWindow!, { title: 'Save Magic Keyframe project', defaultPath: 'Untitled Wedding.mkproj', filters: [{ name: 'Magic Keyframe project', extensions: ['mkproj'] }] })
    if (result.canceled || !result.filePath) return null
    filePath = result.filePath.toLowerCase().endsWith('.mkproj') ? result.filePath : `${result.filePath}.mkproj`
  }
  if (project.media.some((m) => path.resolve(m.path).toLowerCase() === path.resolve(filePath!).toLowerCase())) throw new Error('A project cannot overwrite source media.')
  await writeProject(filePath, project)
  return filePath
})
async function loadProject(requestedPath?: string) {
  let filePath = requestedPath
  if (!filePath) {
    const result = await dialog.showOpenDialog(mainWindow!, { title: 'Open Magic Keyframe project', properties: ['openFile'], filters: [{ name: 'Magic Keyframe project', extensions: ['mkproj'] }] })
    if (result.canceled) return null
    filePath = result.filePaths[0]
  }
  sendCommand('loadStatus', `Reading ${path.basename(filePath)}…`)
  const project = await readProject(filePath)
  const loaded = []
  let relinked = false
  for (const [index, entry] of project.media.entries()) {
    sendCommand('loadStatus', `Opening media ${index + 1}/${project.media.length}: ${path.basename(entry.path)} — checking audio and waveforms…`)
    let source = path.resolve(path.dirname(filePath), entry.path)
    if (!await fileExists(source)) {
      if (entry.absolutePath && await fileExists(entry.absolutePath)) source = entry.absolutePath
      else {
        const result = await dialog.showOpenDialog(mainWindow!, { title: `Locate missing media: ${path.basename(entry.path)}`, properties: ['openFile'] })
        if (result.canceled) return null
        source = result.filePaths[0]; relinked = true
      }
    }
    const item = (await importMediaPaths([source]))[0]
    if ((entry.kind === 'video' && !item.metadata.video) || (entry.kind === 'audio' && (!item.metadata.audio || item.metadata.video))) throw new Error(`Wrong media type for ${entry.path}`)
    if (project.edit[entry.kind].some((s) => s.mediaId === entry.id && s.end > item.metadata.duration + .05)) throw new Error(`Media is shorter than the saved edits: ${item.name}`)
    loaded.push({ ...item, id: entry.id, kind: entry.kind })
  }
  return { path: filePath, project, media: loaded, relinked }
}
ipcMain.handle('project:open', (_event, filePath?: string) => loadProject(filePath))

const recoveryFolder = () => path.join(app.getPath('userData'), 'recovery')
ipcMain.handle('project:autosave', (_event, project: Project, source: string | undefined, session: string) => autosave(recoveryFolder(), project, source, session))
ipcMain.handle('project:recoveries', () => recoveryList(recoveryFolder()))
ipcMain.handle('project:discard-recovery', (_event, source: string | undefined, session: string) => discardRecovery(recoveryFolder(), source, session))
ipcMain.handle('project:recover', async (_event, file: string) => {
  const info = await recoveryInfo(recoveryFolder(), file), result = await loadProject(file)
  return result ? { ...result, path: info.projectPath, recovered: true, session: info.session } : null
})
ipcMain.handle('media:measure-audio', (_event, file: string, start: number, end: number, value?: Partial<ClipEffects>) => measureAudio(file, start, end, value))
ipcMain.handle('media:audio-preview', (_event, file: string, value?: Partial<ClipEffects>) => { if (activeExport) throw new Error('Audio preview is paused during export.'); return audioPreview(file, value) })
ipcMain.handle('media:sync', async (_event, request: { referencePath: string; referenceStart: number; referenceEnd: number; targetPath: string; targetStart: number; targetEnd: number }) => {
  if (!packagedFfmpegPath) throw new Error('FFmpeg is unavailable')
  const [reference, target] = await Promise.all([
    decodeEnvelope(unpackedPath(packagedFfmpegPath), request.referencePath, request.referenceStart, request.referenceEnd),
    decodeEnvelope(unpackedPath(packagedFfmpegPath), request.targetPath, request.targetStart, request.targetEnd),
  ])
  return findSync(reference, target, request.referenceStart, request.targetStart)
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => { for (const task of audioTasks.values()) { task.canceled = true; task.child?.kill() }; if (activeExport) { activeExport.canceled = true; activeExport.child?.kill() }; for (const task of proxyTasks.values()) { task.canceled = true; task.child?.kill() } })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
