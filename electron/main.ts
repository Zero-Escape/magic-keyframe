import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, rename, stat, unlink, readFile, writeFile } from 'node:fs/promises'
import { readProject, writeProject, type Project } from './project-file.js'
import { analyzeWaveform, audioThumbnail, type WaveformData } from './waveform.js'
import packagedFfmpegStaticPath from 'ffmpeg-static'
import { buildTimelineExportFilter, type PlacedSegment } from './export-filter.js'

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
  channels?: number; pix_fmt?: string
}
type ProbeResult = {
  format?: { duration?: string; bit_rate?: string; format_long_name?: string }
  streams?: ProbeStream[]
}

function runProcess(executable: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true })
    const output: Buffer[] = []
    const errors: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => code === 0
      ? resolve(Buffer.concat(output))
      : reject(new Error(Buffer.concat(errors).toString() || `Media process exited with ${code}`)))
  })
}

async function fileExists(filePath: string) {
  try { await access(filePath); return true } catch { return false }
}

const proxyJobs = new Map<string, Promise<{ path: string; url: string }>>()
function generateProxy(filePath: string) {
  let pending = proxyJobs.get(filePath)
  if (!pending) {
    pending = buildProxy(filePath).finally(() => proxyJobs.delete(filePath))
    proxyJobs.set(filePath, pending)
  }
  return pending
}
async function buildProxy(filePath: string) {
  if (!packagedFfmpegPath) throw new Error('FFmpeg is unavailable')
  const proxyFolder = path.join(app.getPath('userData'), 'proxies')
  await mkdir(proxyFolder, { recursive: true })
  const source = await stat(filePath)
  const key = createHash('sha1').update(filePath).update(String(source.size)).update(String(source.mtimeMs)).digest('hex').slice(0, 16)
  const outputPath = path.join(proxyFolder, `${key}-1080p.mp4`)
  if (!await fileExists(outputPath)) {
    const pendingPath = path.join(proxyFolder, `${key}-${process.pid}-${Date.now()}.mp4`)
    const input = ['-y', '-v', 'error', '-i', filePath, '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=-2:1080,format=yuv420p']
    const output = ['-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', pendingPath]
    try {
      try { await runProcess(unpackedPath(packagedFfmpegPath), [...input, '-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '25', ...output]) }
      catch { await runProcess(unpackedPath(packagedFfmpegPath), [...input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', ...output]) }
      await rename(pendingPath, outputPath)
    } catch (error) {
      await unlink(pendingPath).catch(() => {})
      throw error
    }
  }
  return { path: outputPath, url: pathToFileURL(outputPath).toString() }
}

type ExportRequest = { videoPath: string; audioPath?: string; segments: PlacedSegment[]; audioSegments: PlacedSegment[]; videoMuted?: boolean; audioMuted?: boolean; videoHidden?: boolean }

async function exportVideo(request: ExportRequest) {
  if (!packagedFfmpegPath) throw new Error('FFmpeg is unavailable')
  const metadata = await inspectMedia(request.videoPath)
  if (!metadata.video || !Array.isArray(request.segments) || !request.segments.length || !Array.isArray(request.audioSegments)) throw new Error('Invalid timeline edit')
  const valid = (clips: PlacedSegment[], duration: number, video: boolean) => {
    const sorted = [...clips].sort((a, b) => a.at - b.at)
    return sorted.length <= 10000 && sorted.every((c, i) => Number.isFinite(c.start) && Number.isFinite(c.end) && Number.isFinite(c.at)
      && c.start >= 0 && c.end > c.start && c.end <= duration + .05 && (!video || c.at >= -1e-7)
      && (i === 0 || c.at >= sorted[i - 1].at + sorted[i - 1].end - sorted[i - 1].start - 1e-7))
  }
  if (!valid(request.segments, metadata.duration, true)) throw new Error('Invalid video cut points or overlapping clips')
  if (request.audioPath) {
    const audioMetadata = await inspectMedia(request.audioPath)
    if (!valid(request.audioSegments, audioMetadata.duration, false)) throw new Error('Invalid audio cut points or overlapping clips')
  } else if (request.audioSegments.length) throw new Error('Audio clips have no source media')
  const result = await dialog.showSaveDialog({
    title: 'Export 4K MP4',
    defaultPath: path.join(app.getPath('videos'), 'Magic-Keyframe-Export.mp4'),
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  if ([request.videoPath, request.audioPath].some((input) => input && path.resolve(input) === path.resolve(result.filePath!)))
    throw new Error('Choose an export path different from the source media')
  const filter = buildTimelineExportFilter(request.segments, request.audioSegments, Boolean(request.audioPath), Boolean(metadata.audio), {
    width: metadata.video.width || 3840, height: metadata.video.height || 2160, fps: metadata.video.fps || 29.97,
    videoMuted: request.videoMuted ?? Boolean(request.audioPath), audioMuted: request.audioMuted ?? false, videoHidden: request.videoHidden ?? false,
  })
  const args = ['-y', '-v', 'error', '-i', request.videoPath]
  if (request.audioPath) args.push('-i', request.audioPath)
  args.push('-filter_complex', filter, '-map', '[vout]', '-map', '[aout]')
  const pendingPath = path.join(path.dirname(result.filePath), `.${path.basename(result.filePath, '.mp4')}-${process.pid}-${Date.now()}.mp4`)
  const tail = ['-pix_fmt', 'yuv420p', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', pendingPath]
  try {
    try { await runProcess(unpackedPath(packagedFfmpegPath), [...args, '-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '19', '-b:v', '0', ...tail]) }
    catch { await runProcess(unpackedPath(packagedFfmpegPath), [...args, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', ...tail]) }
    await rename(pendingPath, result.filePath)
  } catch (error) {
    await unlink(pendingPath).catch(() => {})
    throw error
  }
  return { canceled: false, path: result.filePath }
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
  const video = probe.streams?.find((stream) => stream.codec_type === 'video')
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
      { type: 'separator' }, { role: 'close' },
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
  ]))
  if (isDev) window.loadURL('http://localhost:5173')
  else window.loadFile(path.join(__dirname, '../dist/index.html'))
}

async function importMediaPaths(paths: string[]) {
  if (!Array.isArray(paths) || paths.length > 100 || paths.some((filePath) => typeof filePath !== 'string')) throw new Error('Invalid media drop')
  const supported = new Set(['.mp4', '.mov', '.mxf', '.wav', '.mp3', '.m4a', '.aac'])
  const files = [...new Set(paths)].filter((filePath) => supported.has(path.extname(filePath).toLowerCase()))
  if (!files.length) throw new Error('Choose MP4, MOV, MXF, WAV, MP3, M4A, or AAC files. Folders cannot be imported.')
  return Promise.all(files.map(async (filePath) => {
    if (!(await stat(filePath)).isFile()) throw new Error('Drop media files, not folders')
    const metadata = await inspectMedia(filePath)
    if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) throw new Error(`Could not determine media duration: ${path.basename(filePath)}`)
    if (!metadata.video && !metadata.audio) throw new Error(`No supported media streams in ${path.basename(filePath)}`)
    return { path: filePath, url: pathToFileURL(filePath).toString(), name: path.basename(filePath), metadata,
      ...await mediaVisuals(filePath, metadata) }
  }))
}

ipcMain.handle('media:import', (_event, paths: string[]) => importMediaPaths(paths))
ipcMain.handle('media:choose', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Add media to Magic Keyframe',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video and audio', extensions: ['mp4', 'mov', 'mxf', 'wav', 'mp3', 'm4a', 'aac'] },
    ],
  })
  if (result.canceled) return []
  return importMediaPaths(result.filePaths)
})

ipcMain.handle('media:proxy', (_event, filePath: string) => generateProxy(filePath))
ipcMain.handle('media:export', (_event, request: ExportRequest) => exportVideo(request))

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
ipcMain.handle('project:open', async (_event, requestedPath?: string) => {
  let filePath = requestedPath
  if (!filePath) {
    const result = await dialog.showOpenDialog(mainWindow!, { title: 'Open Magic Keyframe project', properties: ['openFile'], filters: [{ name: 'Magic Keyframe project', extensions: ['mkproj'] }] })
    if (result.canceled) return null
    filePath = result.filePaths[0]
  }
  const project = await readProject(filePath)
  const loaded = []
  let relinked = false
  for (const entry of project.media) {
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
    if (project.edit[entry.kind].some((s) => s.end > item.metadata.duration + .05)) throw new Error(`Media is shorter than the saved edits: ${item.name}`)
    loaded.push({ ...item, id: entry.id, kind: entry.kind })
  }
  return { path: filePath, project, media: loaded, relinked }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
