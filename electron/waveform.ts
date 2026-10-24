import { spawn } from 'node:child_process'
export type WaveformData = { bucketSeconds: number; channels: { min: number[]; max: number[] }[] }
// Streaming signed stereo envelopes: 5 ms bins, no mono phase cancellation and no
// per-file normalization. Raw PCM is discarded as it arrives, not held in memory.
export function analyzeWaveform(executable: string, file: string, channels: number): Promise<WaveformData> {
  const count = Math.max(1, Math.min(2, channels || 1)), rate = 24000, bucket = 120
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-v', 'error', '-i', file, '-vn', '-ac', String(count), '-ar', String(rate), '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'], { windowsHide: true })
    const data: WaveformData = { bucketSeconds: bucket / rate, channels: Array.from({ length: count }, () => ({ min: [], max: [] })) }
    let pending = Buffer.alloc(0), frames = 0, errors = ''
    let lows = Array(count).fill(Infinity), highs = Array(count).fill(-Infinity)
    const flush = () => { data.channels.forEach((c, i) => { c.min.push(Math.round(lows[i] * 1e5) / 1e5); c.max.push(Math.round(highs[i] * 1e5) / 1e5) }); lows = Array(count).fill(Infinity); highs = Array(count).fill(-Infinity); frames = 0 }
    child.stdout.on('data', (chunk: Buffer) => {
      const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk
      const length = bytes.length - bytes.length % (count * 4)
      for (let at = 0; at < length; at += count * 4) {
        for (let c = 0; c < count; c++) { const sample = Math.max(-1, Math.min(1, bytes.readFloatLE(at + c * 4))); lows[c] = Math.min(lows[c], sample); highs[c] = Math.max(highs[c], sample) }
        if (++frames === bucket) flush()
      }
      pending = Buffer.from(bytes.subarray(length))
    })
    child.stderr.on('data', (chunk) => { errors = (errors + chunk.toString()).slice(-8000) })
    child.on('error', reject)
    child.on('close', (code) => { if (code !== 0) { reject(new Error(errors || 'Waveform decoding failed')); return }; if (frames) flush(); resolve(data) })
  })
}
export function audioThumbnail(waveform: WaveformData) {
  const channel = waveform.channels[0], width = 160, height = 90
  let lines = ''
  for (let x = 0; x < width; x += 2) {
    const from = Math.floor(x / width * channel.min.length), to = Math.max(from + 1, Math.ceil((x + 2) / width * channel.min.length))
    let min = 0, max = 0
    for (let i = from; i < to; i++) { min = Math.min(min, channel.min[i] || 0); max = Math.max(max, channel.max[i] || 0) }
    lines += `<path d="M${x} ${height / 2 - max * 40}V${height / 2 - min * 40}"/>`
  }
  return 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#102b27"/><g stroke="#54dfbf" stroke-width="1.5">${lines}</g></svg>`).toString('base64')
}
