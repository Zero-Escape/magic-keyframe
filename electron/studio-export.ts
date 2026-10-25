import { effects, audioProcessing, videoProcessing } from './effects.js'
import { endAt, timelineEnd, type TimelineEdit, type Segment } from './timeline.js'
export type RenderMedia = { id: string; path: string; audio: boolean; video: boolean }
export function buildStudioExport(edit: TimelineEdit, media: RenderMedia[], width: number, height: number, fps: number) {
  const duration = timelineEnd(edit), filters: string[] = [], videoLabels = new Map<string, string>(), audioLabels = new Map<string, string>()
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The timeline is empty.')
  const visible = edit.video.filter((c) => !edit.lanes.video[c.lane].hidden && endAt(c) > 0)
  const audible = [...edit.video.filter((c) => !edit.lanes.video[c.lane].muted), ...edit.audio.filter((c) => !edit.lanes.audio[c.lane].muted)].filter((c) => endAt(c) > 0 && media.find((m) => m.id === c.mediaId)?.audio)
  media.forEach((item, input) => {
    const v = visible.filter((c) => c.mediaId === item.id), a = audible.filter((c) => c.mediaId === item.id)
    if (v.length) {
      const names = v.map((c, i) => { const label = `vs${input}_${i}`; videoLabels.set(c.id, label); return `[${label}]` })
      filters.push(`[${input}:v]setpts=PTS-STARTPTS,split=${v.length}${names.join('')}`)
    }
    if (a.length) {
      const names = a.map((c, i) => { const label = `as${input}_${i}`; audioLabels.set(c.id, label); return `[${label}]` })
      filters.push(`[${input}:a]asetpts=PTS-STARTPTS,asplit=${a.length}${names.join('')}`)
    }
  })
  filters.push(`color=c=black:s=${width}x${height}:r=${fps.toFixed(8)}:d=${duration.toFixed(6)},format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709[base0]`)
  visible.sort((a, b) => a.lane - b.lane || a.at - b.at).forEach((c, i) => {
    const d = c.end - c.start, e = effects(c.effects), fx = videoProcessing(e, d)
    const chain = [
      `trim=start=${c.start.toFixed(6)}:end=${c.end.toFixed(6)}`, 'setpts=PTS-STARTPTS', `fps=${fps.toFixed(8)}`,
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`, 'setsar=1', ...fx,
      'scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p',
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`, 'setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      `setpts=PTS+${c.at.toFixed(6)}/TB`,
    ]
    filters.push(`[${videoLabels.get(c.id)}]${chain.join(',')}[vc${i}]`)
    filters.push(`[base${i}][vc${i}]overlay=eof_action=pass:repeatlast=0:enable='gte(t,${c.at.toFixed(6)})*lt(t,${endAt(c).toFixed(6)})'[base${i + 1}]`)
  })
  filters.push(`[base${visible.length}]trim=duration=${duration.toFixed(6)},setpts=PTS-STARTPTS[vout]`)
  const labels: string[] = []
  audible.forEach((c: Segment, i) => {
    const e = effects(c.effects), d = c.end - c.start, chain = [`atrim=start=${c.start.toFixed(6)}:end=${c.end.toFixed(6)}`, 'asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=channel_layouts=stereo', ...audioProcessing(e), `volume=${(10 ** (e.gainDb / 20)).toFixed(8)}`]
    if (e.audioFadeIn > 0) chain.push(`afade=t=in:st=0:d=${Math.min(e.audioFadeIn, d / 2).toFixed(6)}`)
    if (e.audioFadeOut > 0) { const fade = Math.min(e.audioFadeOut, d / 2); chain.push(`afade=t=out:st=${(d - fade).toFixed(6)}:d=${fade.toFixed(6)}`) }
    if (c.at < 0) chain.push(`atrim=start=${(-c.at).toFixed(6)}`, 'asetpts=PTS-STARTPTS')
    if (c.at > 0) chain.push(`adelay=${Math.round(c.at * 48000)}S:all=1`)
    filters.push(`[${audioLabels.get(c.id)}]${chain.join(',')}[ac${i}]`); labels.push(`[ac${i}]`)
  })
  if (labels.length) filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,alimiter=limit=0.98:level=0:latency=1,apad,atrim=duration=${duration.toFixed(6)},asetpts=N/SR/TB[aout]`)
  else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration.toFixed(6)},asetpts=N/SR/TB[aout]`)
  return filters.join(';')
}
