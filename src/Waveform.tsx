import { memo, useEffect, useRef } from 'react'
export const Waveform = memo(function Waveform({ data, start, end, left, width, viewport, scroll }: { data?: WaveformData; start: number; end: number; left: number; width: number; viewport: number; scroll: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const inset = Math.max(0, scroll - left), visible = Math.max(0, Math.min(width - inset, scroll + viewport - left - inset))
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !data || visible <= 0 || width <= 0) return
    const ratio = window.devicePixelRatio || 1, height = 50
    canvas.width = Math.ceil(visible * ratio); canvas.height = height * ratio
    const ctx = canvas.getContext('2d')!
    ctx.scale(ratio, ratio); ctx.strokeStyle = '#60dfc6'; ctx.lineWidth = 1
    const band = height / data.channels.length
    data.channels.forEach((channel, c) => {
      const middle = band * (c + .5), amplitude = band * .46
      ctx.globalAlpha = .3; ctx.beginPath(); ctx.moveTo(0, middle); ctx.lineTo(visible, middle); ctx.stroke(); ctx.globalAlpha = .9
      ctx.beginPath()
      for (let x = 0; x < visible; x++) {
        const from = Math.max(0, Math.floor((start + (inset + x) / width * (end - start)) / data.bucketSeconds))
        const to = Math.min(channel.min.length, Math.max(from + 1, Math.ceil((start + (inset + x + 1) / width * (end - start)) / data.bucketSeconds)))
        let low = 1, high = -1
        for (let i = from; i < to; i++) { low = Math.min(low, channel.min[i]); high = Math.max(high, channel.max[i]) }
        if (high >= low) { ctx.moveTo(x + .5, middle - high * amplitude); ctx.lineTo(x + .5, middle - low * amplitude + .6) }
      }
      ctx.stroke()
    })
  }, [data, start, end, inset, visible, width])
  return data && visible > 0 ? <canvas ref={ref} className="waveform detailed-waveform" style={{ left: inset, width: visible, height: 'calc(100% - 20px)' }} aria-hidden="true" /> : null
})

