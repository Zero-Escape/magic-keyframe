import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'
import packagedFfmpegPath from 'ffmpeg-static'

const packagedFfprobePath: string = require('ffprobe-static').path

const isDev = !app.isPackaged
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
    title: 'Magic Key',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) window.loadURL('http://localhost:5173')
  else window.loadFile(path.join(__dirname, '../dist/index.html'))
}

ipcMain.handle('media:choose', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Add media to Magic Key',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video and audio', extensions: ['mp4', 'mov', 'mxf', 'wav', 'mp3', 'm4a', 'aac'] },
    ],
  })
  if (result.canceled) return []
  return Promise.all(result.filePaths.map(async (filePath) => {
    const metadata = await inspectMedia(filePath)
    return {
      path: filePath,
      url: pathToFileURL(filePath).toString(),
      name: path.basename(filePath),
      metadata,
      waveform: metadata.audio ? await createWaveform(filePath) : [],
    }
  }))
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
