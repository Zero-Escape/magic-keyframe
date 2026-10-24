export type ExportSegment = { start: number; end: number }
export type ExportTracks = { videoMuted?: boolean; audioMuted?: boolean; videoHidden?: boolean; audioSegments?: ExportSegment[] }
const seconds = (value: number) => value.toFixed(6)

// Audio-only cuts keep their positions: delayed kept pieces leave silence in the gaps.
// The final video edit then trims and concatenates all enabled audio together.
export function buildExportFilter(segments: ExportSegment[], audioOffset: number, hasExternalAudio: boolean, hasEmbeddedAudio: boolean, tracks: ExportTracks = { videoMuted: hasExternalAudio }): string {
  const count = segments.length
  const filters: string[] = []
  filters.push(`[0:v]${tracks.videoHidden ? 'drawbox=color=black:t=fill,' : ''}split=${count}${segments.map((_, index) => `[vsrc${index}]`).join('')}`)
  const enabledAudio: string[] = []
  if (hasEmbeddedAudio && !tracks.videoMuted) {
    filters.push('[0:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[camera]')
    enabledAudio.push('[camera]')
  }
  if (hasExternalAudio && !tracks.audioMuted && tracks.audioSegments?.length !== 0) {
    const edits = tracks.audioSegments
    if (edits) {
      filters.push(`[1:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,asplit=${edits.length}${edits.map((_, i) => `[edit${i}]`).join('')}`)
      edits.forEach((edit, i) => filters.push(`[edit${i}]atrim=start=${seconds(edit.start)}:end=${seconds(edit.end)},asetpts=PTS-STARTPTS,adelay=${Math.round(edit.start * 1000)}:all=1[kept${i}]`))
      filters.push(`${edits.map((_, i) => `[kept${i}]`).join('')}amix=inputs=${edits.length}:duration=longest:normalize=0[externaledit]`)
    } else {
      filters.push('[1:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[externaledit]')
    }
    let aligned = '[externaledit]anull'
    if (audioOffset > 0) aligned += `,adelay=${Math.round(audioOffset * 1000)}:all=1`
    if (audioOffset < 0) aligned += `,atrim=start=${seconds(-audioOffset)},asetpts=PTS-STARTPTS`
    filters.push(`${aligned}[external]`)
    enabledAudio.push('[external]')
  }
  if (enabledAudio.length) {
    const mix = enabledAudio.length > 1 ? `${enabledAudio.join('')}amix=inputs=${enabledAudio.length}:duration=longest:dropout_transition=0:normalize=1` : `${enabledAudio[0]}anull`
    filters.push(`${mix},apad,asetpts=N/SR/TB,asplit=${count}${segments.map((_, index) => `[asrc${index}]`).join('')}`)
  } else {
    filters.push(`anullsrc=r=48000:cl=stereo,asplit=${count}${segments.map((_, index) => `[asrc${index}]`).join('')}`)
  }
  segments.forEach((segment, index) => {
    const duration = segment.end - segment.start
    filters.push(`[vsrc${index}]trim=start=${seconds(segment.start)}:duration=${seconds(duration)},setpts=PTS-STARTPTS,format=yuv420p[v${index}]`)
    filters.push(`[asrc${index}]atrim=start=${seconds(segment.start)}:duration=${seconds(duration)},asetpts=PTS-STARTPTS[a${index}]`)
  })
  filters.push(`${segments.map((_, index) => `[v${index}][a${index}]`).join('')}concat=n=${count}:v=1:a=1[vout][aout]`)
  return filters.join(';')
}

export type PlacedSegment = { start: number; end: number; at: number }
export type TimelineExportOptions = { width: number; height: number; fps: number; videoMuted?: boolean; audioMuted?: boolean; videoHidden?: boolean }
// A placement-aware render: gaps are real black/silence; moving a clip changes
// its destination, never its source trim. Camera audio follows its video pieces.
export function buildTimelineExportFilter(video: PlacedSegment[], audio: PlacedSegment[], hasExternal: boolean, hasCameraAudio: boolean, options: TimelineExportOptions) {
  const clips = [...video].sort((a, b) => a.at - b.at)
  const endOf = (c: PlacedSegment) => c.at + c.end - c.start
  const duration = Math.max(0, ...clips.map(endOf), ...audio.map(endOf))
  if (!clips.length || !Number.isFinite(duration) || duration <= 0) throw new Error('No video clips to export')
  const filters: string[] = [], pieces: string[] = []
  const black = (duration: number) => {
    const label = `black${pieces.length}`
    filters.push(`color=c=black:s=${options.width}x${options.height}:r=${options.fps.toFixed(8)}:d=${seconds(duration)},setsar=1,format=yuv420p[${label}]`)
    pieces.push(`[${label}]`)
  }
  if (options.videoHidden) black(duration)
  else {
    filters.push(`[0:v]setpts=PTS-STARTPTS,split=${clips.length}${clips.map((_, i) => `[tsrc${i}]`).join('')}`)
    let cursor = 0
    clips.forEach((clip, i) => {
      if (clip.at > cursor + 1e-7) black(clip.at - cursor)
      filters.push(`[tsrc${i}]trim=start=${seconds(clip.start)}:end=${seconds(clip.end)},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[tv${i}]`)
      pieces.push(`[tv${i}]`); cursor = endOf(clip)
    })
    if (duration > cursor + 1e-7) black(duration - cursor)
  }
  filters.push(`${pieces.join('')}concat=n=${pieces.length}:v=1:a=0[vout]`)
  const enabled: string[] = []
  const audioTrack = (input: string, source: PlacedSegment[], label: string) => {
    // Negative audio positions are pre-roll, cropped at the sequence start.
    const kept = source.filter((c) => endOf(c) > 0).map((c) => ({ ...c, start: c.start + Math.max(0, -c.at), at: Math.max(0, c.at) }))
    if (!kept.length) return
    filters.push(`${input}aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,asplit=${kept.length}${kept.map((_, i) => `[${label}src${i}]`).join('')}`)
    kept.forEach((c, i) => filters.push(`[${label}src${i}]atrim=start=${seconds(c.start)}:end=${seconds(c.end)},asetpts=PTS-STARTPTS,adelay=${Math.round(c.at * 48000)}S:all=1[${label}part${i}]`))
    filters.push(`${kept.map((_, i) => `[${label}part${i}]`).join('')}amix=inputs=${kept.length}:duration=longest:normalize=0[${label}]`)
    enabled.push(`[${label}]`)
  }
  if (hasCameraAudio && !options.videoMuted) audioTrack('[0:a]', clips, 'tcamera')
  if (hasExternal && !options.audioMuted) audioTrack('[1:a]', audio, 'texternal')
  if (enabled.length) filters.push(`${enabled.join('')}amix=inputs=${enabled.length}:duration=longest:dropout_transition=0:normalize=${enabled.length > 1 ? 1 : 0},apad,atrim=duration=${seconds(duration)},asetpts=N/SR/TB[aout]`)
  else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${seconds(duration)},asetpts=N/SR/TB[aout]`)
  return filters.join(';')
}
