export type ClipEffects = {
  gainDb: number; audioFadeIn: number; audioFadeOut: number
  vocal: number; noise: number; hiss: number; compression: number; leveling: number
  exposure: number; contrast: number; saturation: number; temperature: number
  fadeIn: number; fadeOut: number
}
export const defaultEffects: ClipEffects = { gainDb: 0, audioFadeIn: 0, audioFadeOut: 0, vocal: 0, noise: 0, hiss: 0, compression: 0, leveling: 0, exposure: 0, contrast: 1, saturation: 1, temperature: 0, fadeIn: 0, fadeOut: 0 }
export const effectLimits: Record<keyof ClipEffects, [number, number]> = {
  gainDb: [-60, 18], audioFadeIn: [0, 30], audioFadeOut: [0, 30], vocal: [0, 1], noise: [0, 30], hiss: [0, 18], compression: [0, 1], leveling: [0, 1], exposure: [-3, 3], contrast: [.5, 2], saturation: [0, 2], temperature: [-1, 1], fadeIn: [0, 10], fadeOut: [0, 10],
}
export function effects(value?: Partial<ClipEffects>): ClipEffects { return { ...defaultEffects, ...value } }
export function fadeFactor(time: number, duration: number, fadeIn: number, fadeOut: number) {
  return Math.max(0, Math.min(1, fadeIn > 0 ? time / fadeIn : 1, fadeOut > 0 ? (duration - time) / fadeOut : 1))
}
// Spectral denoising and conventional speech EQ/compression, not voice isolation.
export function audioProcessing(e: ClipEffects) {
  const filters: string[] = []
  if (e.hiss > 0) filters.push('aresample=48000') // Keep the 8 kHz shelf valid for low-rate sources too.
  const reduction = Math.max(e.noise, e.hiss)
  if (reduction > 0) filters.push(e.hiss > 0 ? `afftdn=nr=${reduction.toFixed(2)}:nf=${e.noise > 0 ? -40 : -50}:nt=w:tn=1:gs=6` : `afftdn=nr=${e.noise.toFixed(2)}:nf=-40:tn=1`)
  if (e.vocal > 0) filters.push(`highpass=f=80,equalizer=f=250:t=q:w=1:g=${(-2 * e.vocal).toFixed(3)},equalizer=f=3000:t=q:w=1:g=${(4 * e.vocal).toFixed(3)},acompressor=threshold=0.125:ratio=${(1 + 1.5 * e.vocal).toFixed(3)}:attack=10:release=150:makeup=${(1 + .5 * e.vocal).toFixed(3)}`)
  // Gentle shelf, not a hard low-pass: preserve speech intelligibility/air.
  if (e.hiss > 0) filters.push(`treble=f=8000:t=q:w=0.707:g=${(-Math.min(3, e.hiss / 6)).toFixed(3)}`)
  if (e.compression > 0) filters.push(`acompressor=threshold=0.125:ratio=${(1 + 5 * e.compression).toFixed(3)}:attack=10:release=250:knee=4:detection=rms:makeup=1`)
  // Continuous source processing is required: the centered smoother looks ahead.
  // Stereo coupling preserves placement; a -50 dB floor avoids boosting silence.
  if (e.leveling > 0) filters.push(`dynaudnorm=f=250:g=15:p=0.9:m=${(1 + 7 * e.leveling).toFixed(3)}:r=${(.08 + .07 * e.leveling).toFixed(4)}:n=1:b=1:t=0.003162`)
  if (e.compression > 0 || e.leveling > 0) filters.push('alimiter=limit=0.95:level=0:latency=1')
  return filters
}
export function videoProcessing(e: ClipEffects, duration: number) {
  const gain = 2 ** e.exposure, white = [1 + e.temperature * .12, 1, 1 - e.temperature * .12]
  const rgb = ['r', 'g', 'b'].map((channel, i) => `${channel}='clip((val*${(gain * white[i]).toFixed(7)}-maxval/2)*${e.contrast.toFixed(7)}+maxval/2,0,maxval)'`).join(':')
  const sat = e.saturation, luma = [.2126, .7152, .0722]
  const matrix = ['r', 'g', 'b'].flatMap((row, r) => ['r', 'g', 'b'].map((col, c) => `${row}${col}=${((1 - sat) * luma[c] + (r === c ? sat : 0)).toFixed(7)}`)).join(':')
  const graded = e.exposure !== 0 || e.contrast !== 1 || e.saturation !== 1 || e.temperature !== 0
  const filters = graded ? [`format=gbrp16le,lutrgb=${rgb},colorchannelmixer=${matrix}`] : []
  if (e.fadeIn > 0) filters.push(`fade=t=in:st=0:d=${Math.min(e.fadeIn, duration / 2).toFixed(6)}`)
  if (e.fadeOut > 0) { const d = Math.min(e.fadeOut, duration / 2); filters.push(`fade=t=out:st=${Math.max(0, duration - d).toFixed(6)}:d=${d.toFixed(6)}`) }
  return filters
}
