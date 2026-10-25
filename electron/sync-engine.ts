import { spawn } from 'node:child_process'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { SyncResult } from './sync-types.js'
export function decodeEnvelope(exe: string, file: string, start: number, end: number): Promise<number[]> {
  if (![start, end].every(Number.isFinite) || start < 0 || end - start < 5 || end - start > 21600) throw new Error('Sync needs between 5 seconds and 6 hours of audio.')
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['-v', 'error', '-ss', String(start), '-i', file, '-t', String(end - start), '-vn', '-map', '0:a:0', '-af', 'highpass=f=250,lowpass=f=3500', '-ac', '2', '-ar', '8000', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'], { windowsHide: true })
    let pending = Buffer.alloc(0), sum = 0, count = 0, error = ''
    const values: number[] = []
    child.stdout.on('data', (chunk: Buffer) => {
      const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk, size = bytes.length - bytes.length % 8
      for (let i = 0; i < size; i += 8) {
        const a = bytes.readFloatLE(i), b = bytes.readFloatLE(i + 4); sum += (a * a + b * b) / 2
        if (++count === 80) { values.push(Math.log1p(500 * Math.sqrt(sum / count))); count = 0; sum = 0 }
      }
      pending = Buffer.from(bytes.subarray(size))
    })
    child.stderr.on('data', (chunk) => { error = (error + chunk.toString()).slice(-4000) })
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(values) : reject(new Error(error || 'Sync decoding failed')))
  })
}
function fft(real: Float64Array, imag: Float64Array, inverse: boolean) {
  const n = real.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]] }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / size, cos = Math.cos(angle), sin = Math.sin(angle)
    for (let from = 0; from < n; from += size) {
      let wr = 1, wi = 0
      for (let j = 0; j < size / 2; j++) {
        const a = from + j, b = a + size / 2, tr = real[b] * wr - imag[b] * wi, ti = real[b] * wi + imag[b] * wr
        real[b] = real[a] - tr; imag[b] = imag[a] - ti; real[a] += tr; imag[a] += ti
        const next = wr * cos - wi * sin; wi = wr * sin + wi * cos; wr = next
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { real[i] /= n; imag[i] /= n }
}
function whiten(input: number[]) {
  const sums = new Float64Array(input.length + 1), output = new Float64Array(input.length)
  input.forEach((v, i) => { sums[i + 1] = sums[i] + v })
  for (let i = 0; i < input.length; i++) { const lo = Math.max(0, i - 100), hi = Math.min(input.length, i + 101); output[i] = input[i] - (sums[hi] - sums[lo]) / (hi - lo) }
  return output
}
function correlate(reference: number[], target: number[], referenceStart: number, targetStart: number): SyncResult {
  const ref = whiten(reference), tar = whiten(target), window = Math.min(9000, ref.length, tar.length)
  if (window < 500) throw new Error('Not enough shared audio for automatic sync.')
  let first = 0, energy = 0, best = -1
  for (let i = 0; i < ref.length; i++) {
    energy += ref[i] ** 2
    if (i >= window) energy -= ref[i - window] ** 2
    if (i >= window - 1 && energy > best) { best = energy; first = i - window + 1 }
  }
  const slice = ref.subarray(first, first + window), mean = slice.reduce((a, b) => a + b, 0) / window
  const centered = Float64Array.from(slice, (v) => v - mean), referenceEnergy = centered.reduce((a, b) => a + b * b, 0)
  if (referenceEnergy < 1e-6) throw new Error('Camera audio has too little variation. Choose a section with speech or a distinct sound.')
  let size = 1; while (size < tar.length + window - 1) size *= 2
  const ar = new Float64Array(size), ai = new Float64Array(size), br = new Float64Array(size), bi = new Float64Array(size)
  ar.set(tar); for (let i = 0; i < window; i++) br[i] = centered[window - 1 - i]
  fft(ar, ai, false); fft(br, bi, false)
  for (let i = 0; i < size; i++) { const real = ar[i] * br[i] - ai[i] * bi[i]; ai[i] = ar[i] * bi[i] + ai[i] * br[i]; ar[i] = real }
  fft(ar, ai, true)
  const sums = new Float64Array(tar.length + 1), squares = new Float64Array(tar.length + 1)
  for (let i = 0; i < tar.length; i++) { sums[i + 1] = sums[i] + tar[i]; squares[i + 1] = squares[i] + tar[i] ** 2 }
  const scores = new Float64Array(tar.length - window + 1)
  let peak = -1, lag = 0
  for (let i = 0; i < scores.length; i++) {
    const total = sums[i + window] - sums[i], variance = squares[i + window] - squares[i] - total * total / window
    scores[i] = variance > 1e-9 ? Math.max(-1, Math.min(1, ar[i + window - 1] / Math.sqrt(referenceEnergy * variance))) : 0
    if (scores[i] > peak) { peak = scores[i]; lag = i }
  }
  let second = -1
  for (let i = 0; i < scores.length; i++) if (Math.abs(i - lag) > 200) second = Math.max(second, scores[i])
  const separation = peak - second, confidence = peak >= .55 && separation >= .08 ? 'high' : peak >= .3 && separation >= .03 ? 'medium' : 'low'
  return { referenceStart: referenceStart + first / 100, targetMatch: targetStart + lag / 100, score: peak, confidence, separation }
}
export function findSync(reference: number[], target: number[], referenceStart: number, targetStart: number): Promise<SyncResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename.replace('app.asar', 'app.asar.unpacked'), { workerData: { magicKeySync: true, reference, target, referenceStart, targetStart } })
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Sync analysis timed out. Try shorter clip sections.')) }, 180000)
    worker.once('message', (result) => { clearTimeout(timer); if (result.error) reject(new Error(result.error)); else resolve(result) })
    worker.once('error', (error) => { clearTimeout(timer); reject(error) })
    worker.once('exit', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error('Sync analysis stopped unexpectedly.')) })
  })
}
if (!isMainThread && workerData?.magicKeySync) {
  try { parentPort!.postMessage(correlate(workerData.reference, workerData.target, workerData.referenceStart, workerData.targetStart)) }
  catch (error) { parentPort!.postMessage({ error: String(error) }) }
}
