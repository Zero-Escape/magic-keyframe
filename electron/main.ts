import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, rename, stat, unlink } from 'node:fs/promises'
import packagedFfmpegStaticPath from 'ffmpeg-static'
import { buildExportFilter, type ExportSegment } from './export-filter.js'

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

async function generateProxy(filePath: string) {
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

type ExportRequest = { videoPath: string; audioPath?: string; segments: ExportSegment[]; audioOffset: number; audioSegments?: ExportSegment[]; videoMuted?: boolean; audioMuted?: boolean; videoHidden?: boolean }

async function exportVideo(request: ExportRequest) {
  if (!packagedFfmpegPath) throw new Error('FFmpeg is unavailable')
  const metadata = await inspectMedia(request.videoPath)
  if (!metadata.video || !Array.isArray(request.segments) || !request.segments.length || !Number.isFinite(request.audioOffset))
    throw new Error('Invalid video edit')
  const valid = request.segments.every((segment, index) => Number.isFinite(segment.start) && Number.isFinite(segment.end)
    && segment.start >= 0 && segment.end > segment.start && segment.end <= metadata.duration + .25
    && (index === 0 || segment.start >= request.segments[index - 1].end))
  if (!valid) throw new Error('Invalid cut points')
  if (request.audioPath && request.audioSegments) {
    const audioMetadata = await inspectMedia(request.audioPath)
    const validAudio = request.audioSegments.every((segment, index) => Number.isFinite(segment.start) && Number.isFinite(segment.end)
      && segment.start >= 0 && segment.end > segment.start && segment.end <= audioMetadata.duration + .25
      && (index === 0 || segment.start >= request.audioSegments![index - 1].end))
    if (!validAudio) throw new Error('Invalid audio cut points')
  }
  const result = await dialog.showSaveDialog({
    title: 'Export 4K MP4',
    defaultPath: path.join(app.getPath('videos'), 'Magic-Keyframe-Export.mp4'),
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  if ([request.videoPath, request.audioPath].some((input) => input && path.resolve(input) === path.resolve(result.filePath!)))
    throw new Error('Choose an export path different from the source media')
  const filter = buildExportFilter(request.segments, request.audioOffset, Boolean(request.audioPath), Boolean(metadata.audio), {
    videoMuted: request.videoMuted ?? Boolean(request.audioPath), audioMuted: request.audioMuted ?? false,
    videoHidden: request.videoHidden ?? false, audioSegments: request.audioSegments,
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

async function createWaveform(filePath: string, bucketCount = 900) {
  if (!packagedFfmpegPath) throw new Error('FFmpeg is unavailable')
  const raw = await runProcess(unpackedPath(packagedFfmpegPath), [
    '-v', 'error', '-i', filePath, '-vn', '-ac', '1', '-ar', '2000',
    '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1',
  ])
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4))
  const size = Math.max(1, Math.floor(samples.length / bucketCount))
  const peaks: number[] = []
  let maximum = 0
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    let peak = 0
    const start = bucket * size
    for (let sample = start; sample < Math.min(samples.length, start + size); sample++) peak = Math.max(peak, Math.abs(samples[sample]))
    maximum = Math.max(maximum, peak)
    peaks.push(peak)
  }
  return peaks.map((peak) => maximum ? Math.min(1, peak / maximum) : 0)
}

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
    if (!metadata.video && !metadata.audio) throw new Error(`No supported media streams in ${path.basename(filePath)}`)
    return { path: filePath, url: pathToFileURL(filePath).toString(), name: path.basename(filePath), metadata,
      waveform: metadata.audio ? await createWaveform(filePath) : [] }
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

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
