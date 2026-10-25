import { effects, audioProcessing, videoProcessing } from './effects.js'
import { endAt, timelineEnd, transitionEdges, type TimelineEdit, type Segment } from './timeline.js'
export type RenderMedia = { id: string; path: string; audio: boolean; video: boolean; seek?: number; stop?: number; audioFor?: string; processed?: boolean }
export function buildStudioExport(edit: TimelineEdit, media: RenderMedia[], width: number, height: number, fps: number, window?: { start: number; duration: number }) {
  const start = window?.start || 0, duration = window?.duration || timelineEnd(edit), finish = start + duration, filters: string[] = [], videoLabels = new Map<string, string>(), audioLabels = new Map<string, string>()
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The timeline is empty.')
  const visible = edit.video.filter((c) => !edit.lanes.video[c.lane].hidden && endAt(c) > start && c.at < finish && media.find((m) => m.id === c.mediaId)?.video)
  const audible = [...edit.video.filter((c) => !edit.lanes.video[c.lane].muted), ...edit.audio.filter((c) => !edit.lanes.audio[c.lane].muted)].filter((c) => endAt(c) > start && c.at < finish && media.some((m) => m.audio && (m.audioFor ? m.audioFor === c.id : m.id === c.mediaId)))
  media.forEach((item, input) => {
    const v = item.video ? visible.filter((c) => c.mediaId === item.id) : [], a = item.audio ? audible.filter((c) => item.audioFor ? item.audioFor === c.id : c.mediaId === item.id) : []
    if (v.length) {
      const names = v.map((c, i) => { const label = `vs${input}_${i}`; videoLabels.set(c.id, label); return `[${label}]` })
      filters.push(`[${input}:v]${window ? 'null' : 'setpts=PTS-STARTPTS'},split=${v.length}${names.join('')}`)
    }
    if (a.length) {
      const names = a.map((c, i) => { const label = `as${input}_${i}`; audioLabels.set(c.id, label); return `[${label}]` })
      filters.push(`[${input}:a]${window ? 'anull' : 'asetpts=PTS-STARTPTS'},asplit=${a.length}${names.join('')}`)
    }
  })
  filters.push(`color=c=black:s=${width}x${height}:r=${fps.toFixed(8)}:d=${duration.toFixed(6)},format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709[base0]`)
  visible.sort((a, b) => a.lane - b.lane || a.at - b.at).forEach((c, i) => {
    const d = c.end - c.start, blend = transitionEdges(edit.video, c), e = effects(c.effects), fx = videoProcessing({ ...e, fadeIn: blend.incoming ? 0 : e.fadeIn, fadeOut: blend.outgoing ? 0 : e.fadeOut }, d)
    const seek = window ? media.find((m) => m.id === c.mediaId)?.seek || 0 : 0, from = Math.max(start, c.at), to = Math.min(finish, endAt(c))
    const chain = [
      `trim=start=${Math.max(0, c.start - seek).toFixed(6)}:end=${(c.end - seek).toFixed(6)}`, window ? `setpts=PTS+${(seek - c.start).toFixed(6)}/TB` : 'setpts=PTS-STARTPTS', `fps=${fps.toFixed(8)}`,
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`, 'setsar=1', ...fx,
      'scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p',
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`, 'setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      'format=yuva420p', ...(blend.incoming ? [`fade=t=in:st=0:d=${blend.incoming.toFixed(6)}:alpha=1`] : []),
      ...(window ? [`trim=start=${Math.max(0, from - c.at - 1 / fps).toFixed(6)}:end=${(to - c.at).toFixed(6)}`] : []),
      `setpts=PTS+${(c.at - start).toFixed(6)}/TB`,
    ]
    filters.push(`[${videoLabels.get(c.id)}]${chain.join(',')}[vc${i}]`)
    filters.push(`[base${i}][vc${i}]overlay=eof_action=pass:repeatlast=0:enable='gte(t,${(from - start).toFixed(6)})*lt(t,${(to - start).toFixed(6)})'[base${i + 1}]`)
  })
  filters.push(`[base${visible.length}]trim=duration=${duration.toFixed(6)},setpts=PTS-STARTPTS[vout]`)
  const labels: string[] = []
  audible.forEach((c: Segment, i) => {
    const track = edit.video.some((v) => v.id === c.id) ? edit.video : edit.audio, blend = transitionEdges(track, c)
    const input = media.find((m) => m.audioFor === c.id) || media.find((m) => m.id === c.mediaId && m.audio)
    const seek = window ? input?.seek || 0 : 0, from = Math.max(start, c.at), to = Math.min(finish, endAt(c))
    const stored = effects(c.effects), e = { ...stored, audioFadeIn: blend.incoming ? 0 : stored.audioFadeIn, audioFadeOut: blend.outgoing ? 0 : stored.audioFadeOut }, d = c.end - c.start, chain = [`atrim=start=${Math.max(0, c.start - seek).toFixed(6)}:end=${(c.end - seek).toFixed(6)}`, window ? `asetpts=PTS+${(seek - c.start).toFixed(6)}/TB` : 'asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=channel_layouts=stereo', ...(input?.processed ? [] : audioProcessing(e)), `volume=${(10 ** (e.gainDb / 20)).toFixed(8)}`]
    if (blend.incoming) chain.push(`afade=t=in:st=0:d=${blend.incoming.toFixed(6)}:curve=qsin`)
    if (blend.outgoing) chain.push(`afade=t=out:st=${(d - blend.outgoing).toFixed(6)}:d=${blend.outgoing.toFixed(6)}:curve=qsin`)
    if (e.audioFadeIn > 0) chain.push(`afade=t=in:st=0:d=${Math.min(e.audioFadeIn, d / 2).toFixed(6)}`)
    if (e.audioFadeOut > 0) { const fade = Math.min(e.audioFadeOut, d / 2); chain.push(`afade=t=out:st=${(d - fade).toFixed(6)}:d=${fade.toFixed(6)}`) }
    if (window) chain.push(`atrim=start=${(from - c.at).toFixed(6)}:end=${(to - c.at).toFixed(6)}`, 'asetpts=PTS-STARTPTS')
    if (!window && c.at < 0) chain.push(`atrim=start=${(-c.at).toFixed(6)}`, 'asetpts=PTS-STARTPTS')
    if (from > start) chain.push(`adelay=${Math.round((from - start) * 48000)}S:all=1`)
    filters.push(`[${audioLabels.get(c.id)}]${chain.join(',')}[ac${i}]`); labels.push(`[ac${i}]`)
  })
  if (labels.length) filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,alimiter=limit=0.98:level=0:latency=1,apad,atrim=end_sample=${Math.round(finish * 48000) - Math.round(start * 48000)},asetpts=N/SR/TB[aout]`)
  else filters.push(`anullsrc=r=48000:cl=stereo,atrim=end_sample=${Math.round(finish * 48000) - Math.round(start * 48000)},asetpts=N/SR/TB[aout]`)
  return filters.join(';')
}
