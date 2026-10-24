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
