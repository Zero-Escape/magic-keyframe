import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AudioLines, ChevronDown, Clapperboard, Download, Eye, EyeOff, FolderOpen, KeyRound, Layers3, Pause, Play, Plus, Redo2, Scissors, SkipBack, SkipForward, Sparkles, Trash2, Undo2, Video, Volume2, VolumeX, WandSparkles, ZoomIn, ZoomOut } from 'lucide-react'

type Track = 'video' | 'audio'
type MediaItem = ImportedMedia & { id: string; kind: Track }
type Segment = { id: string; start: number; end: number }
type Edit = { video: Segment[]; audio: Segment[]; audioOffset: number }
const formatTime = (seconds: number, precise = false) => {
  const whole = Math.max(0, Math.floor(seconds))
  const clock = `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
  return precise ? `${clock}.${String(Math.max(0, Math.floor((seconds - whole) * 100))).padStart(2, '0')}` : clock
}
const contains = (items: Segment[], time: number) => items.some((item) => time >= item.start && time < item.end)
const Waveform = memo(function Waveform({ peaks, start = 0, end = 1 }: { peaks?: number[]; start?: number; end?: number }) {
  const bars = useMemo(() => {
    const slice = peaks?.slice(Math.floor(start * peaks.length), Math.ceil(end * peaks.length)) || []
    return slice.filter((_, i) => i % Math.max(1, Math.ceil(slice.length / 900)) === 0)
  }, [peaks, start, end])
  return bars.length ? <svg className="waveform" viewBox={`0 0 ${bars.length} 100`} preserveAspectRatio="none" aria-hidden="true">{bars.map((height, i) => <line key={i} x1={i + .5} x2={i + .5} y1={50 - Math.max(2, height * 48)} y2={50 + Math.max(2, height * 48)} stroke="currentColor" strokeWidth=".7" />)}</svg> : <div className="waveform loading-waveform" />
})

export default function App() {
  const [media, setMedia] = useState<MediaItem[]>([])
  const [edit, setEdit] = useState<Edit>({ video: [], audio: [], audioOffset: 0 })
  const [selectedTrack, setSelectedTrack] = useState<Track>('video')
  const [selectedIds, setSelectedIds] = useState<Record<Track, string | null>>({ video: null, audio: null })
  const [undoStack, setUndoStack] = useState<Edit[]>([])
  const [redoStack, setRedoStack] = useState<Edit[]>([])
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [proxyUrl, setProxyUrl] = useState<string>()
  const [proxying, setProxying] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [videoMuted, setVideoMuted] = useState(false)
  const [audioMuted, setAudioMuted] = useState(false)
  const [videoHidden, setVideoHidden] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; message: string } | null>(null)
  const [trimDraft, setTrimDraft] = useState({ start: '0.000', end: '0.000' })
  const [timelineHeight, setTimelineHeight] = useState(330)
  const [sidebarWidth, setSidebarWidth] = useState(290)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  const trackViewportRef = useRef<HTMLDivElement>(null)
  const positionRef = useRef(0)
  const clockRef = useRef({ time: 0, now: 0 })
  const playbackEndRef = useRef(0)
  const resumeAfterProxyRef = useRef<number | null>(null)
  const pendingPlayRef = useRef(new Set<HTMLMediaElement>())
  const importLockRef = useRef(false)
  const dragDepthRef = useRef(0)
  const scrubbingRef = useRef(false)
  const audioDragRef = useRef<{ x: number; offset: number; moved: boolean } | null>(null)
  const trimDragRef = useRef<{ track: Track; id: string; edge: 'start' | 'end' } | null>(null)
  const resizingRef = useRef<{ kind: 'sidebar' | 'timeline'; initial: number; x: number; y: number } | null>(null)
  const video = media.find((item) => item.kind === 'video')
  const audio = media.find((item) => item.kind === 'audio')
  const videoDuration = video?.metadata.duration || 0
  const audioDuration = audio?.metadata.duration || 0
  const timelineDuration = Math.max(videoDuration, audio ? audioDuration + edit.audioOffset : 0, 1)
  const fps = video?.metadata.video?.fps || 29.97
  const frame = 1 / fps
  const currentSegments = edit[selectedTrack]
  const selectedSegment = currentSegments.find((item) => item.id === selectedIds[selectedTrack]) || currentSegments[0]
  const selectedOffset = selectedTrack === 'audio' ? edit.audioOffset : 0
  const canSplit = currentSegments.some((item) => position - selectedOffset > item.start + frame / 2 && position - selectedOffset < item.end - frame / 2)
  const rulerTicks = Math.min(240, Math.max(7, Math.round(7 * zoom / 100)))
  const pictureVisible = !!video && !videoHidden && contains(edit.video, position)

  useEffect(() => { if (selectedSegment) setTrimDraft({ start: selectedSegment.start.toFixed(3), end: selectedSegment.end.toFixed(3) }) }, [selectedTrack, selectedSegment?.id, selectedSegment?.start, selectedSegment?.end])
  const recordHistory = () => { setUndoStack((items) => [...items.slice(-29), edit]); setRedoStack([]) }
  const undo = () => { if (!undoStack.length) return; setRedoStack((items) => [...items, edit]); setEdit(undoStack[undoStack.length - 1]); setUndoStack((items) => items.slice(0, -1)) }
  const redo = () => { if (!redoStack.length) return; setUndoStack((items) => [...items, edit]); setEdit(redoStack[redoStack.length - 1]); setRedoStack((items) => items.slice(0, -1)) }
  const safePlay = (player: HTMLMediaElement) => {
    if (!player.paused || pendingPlayRef.current.has(player)) return
    pendingPlayRef.current.add(player)
    void player.play().catch(() => {}).finally(() => pendingPlayRef.current.delete(player))
  }
  const syncPlayers = (time: number, play: boolean, force = false) => {
    const camera = videoRef.current
    if (camera && video) {
      camera.muted = videoMuted
      if (time < videoDuration && contains(edit.video, time)) {
        if (force || Math.abs(camera.currentTime - time) > .15) camera.currentTime = Math.max(0, time)
        if (play) safePlay(camera); else camera.pause()
      } else camera.pause()
    }
    const recorder = audioRef.current
    if (recorder && audio) {
      const wanted = time - edit.audioOffset
      recorder.muted = audioMuted || !contains(edit.audio, wanted)
      if (wanted >= 0 && wanted < audioDuration) {
        if (force || Math.abs(recorder.currentTime - wanted) > .12) recorder.currentTime = wanted
        if (play) safePlay(recorder); else recorder.pause()
      } else recorder.pause()
    }
  }
  const seekTo = (time: number) => {
    const next = Math.max(0, Math.min(timelineDuration, time))
    positionRef.current = next; clockRef.current = { time: next, now: performance.now() }; setPosition(next)
    syncPlayers(next, playing, true)
  }
  useEffect(() => {
    if (!playing) { videoRef.current?.pause(); audioRef.current?.pause(); return }
    let request = 0, lastPaint = 0
    const tick = (now: number) => {
      let time = clockRef.current.time + (now - clockRef.current.now) / 1000
      const videoEnd = edit.video.at(-1)?.end || 0
      if (video && time < videoEnd && !contains(edit.video, time)) {
        const next = edit.video.find((item) => item.start > time)
        if (next) { time = next.start; clockRef.current = { time, now } }
      }
      if (time >= playbackEndRef.current) {
        positionRef.current = playbackEndRef.current; setPosition(playbackEndRef.current); setPlaying(false)
        videoRef.current?.pause(); audioRef.current?.pause(); return
      }
      positionRef.current = time
      syncPlayers(time, true)
      if (now - lastPaint >= 33) { setPosition(time); lastPaint = now }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [playing, edit, videoMuted, audioMuted, video?.id, audio?.id, timelineDuration])
  const togglePlayback = () => {
    if (playing) { seekTo(positionRef.current); setPlaying(false); return }
    if (!media.length) return
    const videoEnd = edit.video.at(-1)?.end || 0
    let start = positionRef.current
    if (video && start >= videoEnd - frame && selectedTrack !== 'audio') start = edit.video[0]?.start || 0
    else if (start >= timelineDuration - frame) start = 0
    playbackEndRef.current = video && start < videoEnd ? videoEnd : timelineDuration
    seekTo(start); syncPlayers(start, true, true); setPlaying(true)
  }
  const importMedia = async (paths?: string[]) => {
    if (!window.magicKey || importLockRef.current) return
    importLockRef.current = true; setImporting(true); setNotice(null)
    try {
      const picked = paths ? await window.magicKey.importMedia(paths) : await window.magicKey.chooseMedia()
      let hasVideo = !!video, hasAudio = !!audio
      const accepted: MediaItem[] = []
      for (const item of picked) {
        if (media.some((existing) => existing.path === item.path)) continue
        const kind: Track = item.metadata.video ? 'video' : 'audio'
        if (kind === 'video' ? hasVideo : hasAudio) continue
        if (kind === 'video') hasVideo = true; else hasAudio = true
        accepted.push({ ...item, id: crypto.randomUUID(), kind })
      }
      if (picked.length && !accepted.length) { setNotice({ kind: 'error', message: 'This test build uses one video and one external audio file. Those tracks are already loaded.' }); return }
      setMedia((items) => [...items, ...accepted])
      let nextEdit = edit
      for (const item of accepted) {
        const segment = { id: crypto.randomUUID(), start: 0, end: item.metadata.duration }
        nextEdit = { ...nextEdit, [item.kind]: [segment] }
        setSelectedIds((ids) => ({ ...ids, [item.kind]: segment.id }))
        if (item.kind === 'audio') setVideoMuted(true)
      }
      setEdit(nextEdit); setUndoStack([]); setRedoStack([])
      if (!video && accepted.some((item) => item.kind === 'video')) { setSelectedTrack('video'); setZoom(100) }
      else if (!video && accepted.length) setSelectedTrack('audio')
      if (accepted.length < picked.length && accepted.length) setNotice({ kind: 'success', message: 'Imported the available tracks. Extra/duplicate files were skipped; this build uses one video and one external audio file.' })
      const addedVideo = accepted.find((item) => item.kind === 'video')
      if (addedVideo) {
        setProxying(true)
        void window.magicKey.generateProxy(addedVideo.path).then((proxy) => {
          resumeAfterProxyRef.current = positionRef.current; setProxyUrl(proxy.url)
        }).catch((error) => setNotice({ kind: 'error', message: `Proxy failed; original remains available. ${String(error)}` })).finally(() => setProxying(false))
      }
    } catch (error) { setNotice({ kind: 'error', message: `Import failed: ${String(error)}` }) }
    finally { importLockRef.current = false; setImporting(false) }
  }
  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault(); dragDepthRef.current = 0; setDropping(false)
    try {
      const paths = Array.from(event.dataTransfer.files).map((file) => window.magicKey?.getPathForFile(file)).filter((path): path is string => !!path)
      if (paths.length) void importMedia(paths)
      else setNotice({ kind: 'error', message: 'Drop local media files from File Explorer.' })
    } catch (error) { setNotice({ kind: 'error', message: `Could not read dropped files: ${String(error)}` }) }
  }
  const handleExport = async () => {
    if (!video || !window.magicKey || !edit.video.length) return
    setExporting(true); setNotice(null)
    try {
      const result = await window.magicKey.exportVideo({ videoPath: video.path, audioPath: audio?.path, segments: edit.video, audioSegments: edit.audio, audioOffset: edit.audioOffset, videoMuted, audioMuted, videoHidden })
      if (result.path) setNotice({ kind: 'success', message: `Export saved: ${result.path}` })
    } catch (error) { setNotice({ kind: 'error', message: `Export failed: ${String(error)}` }) }
    finally { setExporting(false) }
  }
  const splitAtPlayhead = () => {
    const at = Math.round((position - selectedOffset) * fps) / fps
    const index = currentSegments.findIndex((item) => at > item.start + frame / 2 && at < item.end - frame / 2)
    if (index < 0) return
    const original = currentSegments[index], right = { id: crypto.randomUUID(), start: at, end: original.end }
    recordHistory(); setEdit({ ...edit, [selectedTrack]: [...currentSegments.slice(0, index), { ...original, end: at }, right, ...currentSegments.slice(index + 1)] })
    setSelectedIds((ids) => ({ ...ids, [selectedTrack]: right.id }))
  }
  const removeSelected = () => {
    if (!selectedSegment || (selectedTrack === 'video' && currentSegments.length < 2)) return
    recordHistory(); setEdit({ ...edit, [selectedTrack]: currentSegments.filter((item) => item.id !== selectedSegment.id) })
    setSelectedIds((ids) => ({ ...ids, [selectedTrack]: null }))
  }
  const edgeLimit = (items: Segment[], index: number, edge: 'start' | 'end', value: number, track: Track) => edge === 'start'
    ? Math.min(items[index].end - frame, Math.max(index ? items[index - 1].end : 0, value))
    : Math.max(items[index].start + frame, Math.min(index < items.length - 1 ? items[index + 1].start : track === 'video' ? videoDuration : audioDuration, value))
  const commitTrimInput = (edge: 'start' | 'end') => {
    if (!selectedSegment) return
    const value = Number(trimDraft[edge]), index = currentSegments.findIndex((item) => item.id === selectedSegment.id)
    if (!Number.isFinite(value)) return
    const next = edgeLimit(currentSegments, index, edge, Math.round(value * fps) / fps, selectedTrack)
    if (Math.abs(next - selectedSegment[edge]) < frame / 2) { setTrimDraft({ start: selectedSegment.start.toFixed(3), end: selectedSegment.end.toFixed(3) }); return }
    recordHistory(); setEdit({ ...edit, [selectedTrack]: currentSegments.map((item) => item.id === selectedSegment.id ? { ...item, [edge]: next } : item) })
  }
  const timelinePoint = (x: number) => { const bounds = tracksRef.current!.getBoundingClientRect(); return Math.max(0, Math.min(timelineDuration, (x - bounds.left) / bounds.width * timelineDuration)) }
  const beginScrub = (event: React.PointerEvent) => {
    const clip = (event.target as Element).closest<HTMLElement>('[data-segment-id]')
    if (clip) { const track = clip.dataset.track as Track; setSelectedTrack(track); setSelectedIds((ids) => ({ ...ids, [track]: clip.dataset.segmentId! })) }
    event.currentTarget.setPointerCapture(event.pointerId); scrubbingRef.current = true; seekTo(Math.round(timelinePoint(event.clientX) * fps) / fps)
  }
  const moveScrub = (event: React.PointerEvent) => { if (scrubbingRef.current) seekTo(Math.round(timelinePoint(event.clientX) * fps) / fps) }
  const beginTrim = (event: React.PointerEvent, track: Track, id: string, edge: 'start' | 'end') => {
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); recordHistory(); setSelectedTrack(track); setSelectedIds((ids) => ({ ...ids, [track]: id })); trimDragRef.current = { track, id, edge }
  }
  const moveTrim = (event: React.PointerEvent) => {
    event.stopPropagation(); const drag = trimDragRef.current; if (!drag) return
    const value = Math.round((timelinePoint(event.clientX) - (drag.track === 'audio' ? edit.audioOffset : 0)) * fps) / fps
    setEdit((current) => { const items = current[drag.track], index = items.findIndex((item) => item.id === drag.id); return index < 0 ? current : { ...current, [drag.track]: items.map((item, at) => at === index ? { ...item, [drag.edge]: edgeLimit(items, index, drag.edge, value, drag.track) } : item) } })
  }
  const beginAudioDrag = (event: React.PointerEvent, id: string) => {
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedTrack('audio'); setSelectedIds((ids) => ({ ...ids, audio: id })); seekTo(timelinePoint(event.clientX)); audioDragRef.current = { x: event.clientX, offset: edit.audioOffset, moved: false }
  }
  const moveAudioDrag = (event: React.PointerEvent) => {
    event.stopPropagation(); const drag = audioDragRef.current; if (!drag || !tracksRef.current) return
    if (!drag.moved && Math.abs(event.clientX - drag.x) < 3) return
    if (!drag.moved) { recordHistory(); drag.moved = true }
    const offset = drag.offset + (event.clientX - drag.x) / tracksRef.current.clientWidth * timelineDuration
    setEdit((current) => ({ ...current, audioOffset: offset }))
  }
  const changeZoom = (value: number) => { setZoom(value); requestAnimationFrame(() => { if (trackViewportRef.current && tracksRef.current) trackViewportRef.current.scrollLeft = position / timelineDuration * tracksRef.current.clientWidth - trackViewportRef.current.clientWidth / 2 }) }
  const beginResize = (event: React.PointerEvent, kind: 'sidebar' | 'timeline') => { event.currentTarget.setPointerCapture(event.pointerId); resizingRef.current = { kind, initial: kind === 'sidebar' ? sidebarWidth : timelineHeight, x: event.clientX, y: event.clientY } }
  const moveResize = (event: React.PointerEvent) => { const drag = resizingRef.current; if (!drag) return; if (drag.kind === 'sidebar') setSidebarWidth(Math.max(220, Math.min(560, drag.initial + event.clientX - drag.x))); else setTimelineHeight(Math.max(220, Math.min(window.innerHeight - 300, drag.initial + drag.y - event.clientY))) }
  const selectTrack = (track: Track) => setSelectedTrack(track)
  const renderClip = (track: Track, segment: Segment) => {
    const item = track === 'video' ? video : audio; if (!item) return null
    const offset = track === 'audio' ? edit.audioOffset : 0
    return <div key={segment.id} data-track={track} data-segment-id={segment.id} className={`clip ${track}-clip ${track === 'audio' ? 'draggable' : ''} ${selectedTrack === track && selectedSegment?.id === segment.id ? 'selected' : ''}`} style={{ left: `${(segment.start + offset) / timelineDuration * 100}%`, width: `${(segment.end - segment.start) / timelineDuration * 100}%` }} onPointerDown={track === 'audio' ? (event) => beginAudioDrag(event, segment.id) : undefined} onPointerMove={track === 'audio' ? moveAudioDrag : undefined} onPointerUp={track === 'audio' ? () => { audioDragRef.current = null } : undefined}>
      <span className="trim-handle left" title="Drag to trim start" onPointerDown={(event) => beginTrim(event, track, segment.id, 'start')} onPointerMove={moveTrim} onPointerUp={() => { trimDragRef.current = null }} onPointerCancel={() => { trimDragRef.current = null }} />
      <Waveform peaks={item.waveform} start={segment.start / item.metadata.duration} end={segment.end / item.metadata.duration} />
      <div className="clip-title"><strong>{item.name}</strong><small>{formatTime(segment.start)} → {formatTime(segment.end)}</small></div>
      <span className="trim-handle right" title="Drag to trim end" onPointerDown={(event) => beginTrim(event, track, segment.id, 'end')} onPointerMove={moveTrim} onPointerUp={() => { trimDragRef.current = null }} onPointerCancel={() => { trimDragRef.current = null }} />
    </div>
  }
  return <main className="app-shell" style={{ '--timeline-height': `${timelineHeight}px`, '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepthRef.current++; setDropping(true) } }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
    onDragLeave={(event) => { event.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (!dragDepthRef.current) setDropping(false) }} onDrop={handleDrop}>
    {dropping && <div className="drop-overlay"><FolderOpen size={42} /><strong>Drop media to import</strong><span>Local video or audio files · originals stay untouched</span></div>}
    <header className="topbar"><div className="brand"><span className="brand-mark"><KeyRound size={18} /></span><span>Magic Keyframe</span></div><div className="project-title"><span className="status-dot" /> Untitled Wedding <ChevronDown size={14} /></div><div className="top-actions"><button className="icon-button" title="Undo edit" onClick={undo} disabled={!undoStack.length}><Undo2 size={17} /></button><button className="icon-button" title="Redo edit" onClick={redo} disabled={!redoStack.length}><Redo2 size={17} /></button><button className="button primary" onClick={handleExport} disabled={!video || !edit.video.length || exporting}><Download size={16} />{exporting ? 'Exporting…' : 'Export'}</button></div></header>
    <section className="workspace"><aside className="media-panel panel"><div className="panel-heading"><div><span className="eyebrow">PROJECT</span><h2>Media</h2></div><button className="icon-button" onClick={() => void importMedia()} disabled={importing}><Plus size={18} /></button></div><button className="import-card" onClick={() => void importMedia()} disabled={importing}><span><FolderOpen size={21} /></span><strong>{importing ? 'Analysing media…' : 'Import footage'}</strong><small>Click or drop video and audio here</small></button><div className="media-list">{!media.length && <div className="empty-media"><Clapperboard size={25} /><p>Drop footage anywhere in the window.</p><small>Start with the camera video and matching recorder audio.</small></div>}{media.map((item) => <div className="media-item" key={item.id}><span className={`media-icon ${item.kind}`}>{item.kind === 'video' ? <Video size={16} /> : <AudioLines size={16} />}</span><span className="media-copy"><strong>{item.name}</strong><small>{item.metadata.video ? `${item.metadata.video.width}×${item.metadata.video.height} · ${item.metadata.video.fps?.toFixed(2)} fps` : `${(item.metadata.audio?.sampleRate || 0) / 1000} kHz · ${item.metadata.audio?.channels === 1 ? 'Mono' : 'Stereo'}`}</small></span></div>)}</div><div className="assistant-card"><WandSparkles size={18} /><div><strong>Track monitoring</strong><small>Mute each source independently to compare sync.</small></div></div></aside>
      <section className="viewer-panel panel"><div className="viewer-heading"><span>Preview</span><span className="quality-pill">{proxying ? 'BUILDING PROXY…' : proxyUrl ? 'PROXY · 1080P' : 'ORIGINAL'}<ChevronDown size={12} /></span></div>{notice && <div className={`status-banner ${notice.kind}`}><span>{notice.message}</span><button title="Dismiss message" onClick={() => setNotice(null)}>×</button></div>}<div className="viewer">{video ? <><video ref={videoRef} src={proxyUrl || video.url} style={{ visibility: pictureVisible ? 'visible' : 'hidden' }} muted={videoMuted} onLoadedMetadata={() => { if (resumeAfterProxyRef.current !== null) { syncPlayers(resumeAfterProxyRef.current, playing, true); resumeAfterProxyRef.current = null } }} />{!pictureVisible && <div className="hidden-video-notice"><EyeOff size={24} /><span>{videoHidden ? 'Video 1 hidden' : 'No video at this position'}</span></div>}</> : <div className="viewer-empty"><span className="glow"><Sparkles size={30} /></span><h1>{audio ? 'Audio is ready to edit' : 'Your story starts here'}</h1><p>{audio ? 'Select Audio 1 to trim, split, or remove sections.' : 'Import or drop your footage to begin.'}</p><button className="button primary" onClick={() => void importMedia()}><Plus size={16} /> Add media</button></div>}<audio ref={audioRef} src={audio?.url} muted={audioMuted || !contains(edit.audio, position - edit.audioOffset)} /></div><div className="transport"><span className="timecode">{formatTime(position, true)}<em> / {formatTime(timelineDuration, true)}</em></span><div className="transport-controls"><button title="Previous cut" onClick={() => seekTo(([...currentSegments].reverse().find((item) => item.start + selectedOffset < position - frame)?.start || 0) + selectedOffset)}><SkipBack size={18} /></button><button className="play-button" onClick={togglePlayback}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button title="Next cut" onClick={() => seekTo((currentSegments.find((item) => item.start + selectedOffset > position + frame)?.start ?? currentSegments.at(-1)?.end ?? 0) + selectedOffset)}><SkipForward size={18} /></button></div><div className="volume"><Volume2 size={17} /><span><i /></span></div></div></section>
      <div className="sidebar-resizer" title="Drag to resize media panel" onPointerDown={(event) => beginResize(event, 'sidebar')} onPointerMove={moveResize} onPointerUp={() => { resizingRef.current = null }} onPointerCancel={() => { resizingRef.current = null }} /></section>
    <section className="timeline-panel panel"><div className="timeline-resizer" title="Drag to resize timeline" onPointerDown={(event) => beginResize(event, 'timeline')} onPointerMove={moveResize} onPointerUp={() => { resizingRef.current = null }} onPointerCancel={() => { resizingRef.current = null }} /><div className="timeline-tools"><div className="tool-group"><span className={`tool active ${selectedTrack === 'audio' ? 'audio-selection' : ''}`}><Layers3 size={16} />{selectedTrack === 'video' ? 'Video 1' : 'Audio 1'}</span><button className="tool" title="Split selected track at the playhead" onClick={splitAtPlayhead} disabled={!canSplit}><Scissors size={16} /> Split</button><button className="tool remove-tool" title="Remove selected section; audio gaps stay silent" onClick={removeSelected} disabled={!selectedSegment || (selectedTrack === 'video' && currentSegments.length < 2)}><Trash2 size={15} /> Remove</button></div><div className="edit-controls"><div className="align-controls"><button onClick={() => { recordHistory(); setEdit({ ...edit, audioOffset: edit.audioOffset - frame }) }} disabled={!audio}>−1 frame</button><span>{edit.audioOffset >= 0 ? '+' : ''}{edit.audioOffset.toFixed(3)}s</span><button onClick={() => { recordHistory(); setEdit({ ...edit, audioOffset: edit.audioOffset + frame }) }} disabled={!audio}>+1 frame</button></div><div className="trim-inputs">{(['start', 'end'] as const).map((edge) => <label key={edge}>{edge === 'start' ? 'IN' : 'OUT'}<input aria-label={`${edge === 'start' ? 'In' : 'Out'} point in source seconds`} type="number" step={frame} value={trimDraft[edge]} disabled={!selectedSegment} onChange={(event) => setTrimDraft((current) => ({ ...current, [edge]: event.target.value }))} onBlur={() => commitTrimInput(edge)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>)}</div></div><div className="zoom"><button title="Fit full timeline" onClick={() => changeZoom(100)}>Fit</button><ZoomOut size={16} /><input aria-label="Timeline zoom" type="range" min="100" max="4000" step="50" value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} /><ZoomIn size={16} /><span>{Math.round(zoom / 100)}×</span></div></div>
      <div className="timeline-scroll"><div className="track-labels"><div className="ruler-spacer" />{(['video', 'audio'] as const).map((track) => <div key={track} className={`track-header ${selectedTrack === track ? 'selected-track' : ''}`} onClick={() => selectTrack(track)}><button className="track-select" onClick={() => selectTrack(track)}>{track === 'video' ? <Video size={14} /> : <AudioLines size={14} />}<span>{track === 'video' ? 'VIDEO 1' : 'AUDIO 1'}</span></button><div className="track-switches"><button aria-label={`${track === 'video' ? videoMuted ? 'Unmute' : 'Mute' : audioMuted ? 'Unmute' : 'Mute'} ${track === 'video' ? 'Video 1' : 'Audio 1'}`} title="Mute affects preview and export" aria-pressed={track === 'video' ? videoMuted : audioMuted} className={(track === 'video' ? videoMuted : audioMuted) ? 'switch-off' : ''} disabled={track === 'video' ? !video : !audio} onClick={(event) => { event.stopPropagation(); setSelectedTrack(track); if (track === 'video') setVideoMuted(!videoMuted); else setAudioMuted(!audioMuted) }}>{(track === 'video' ? videoMuted : audioMuted) ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>{track === 'video' && <button aria-label={videoHidden ? 'Show Video 1' : 'Hide Video 1'} title="Video visibility affects preview and export; audio is separate" aria-pressed={videoHidden} className={videoHidden ? 'switch-off' : ''} disabled={!video} onClick={(event) => { event.stopPropagation(); setSelectedTrack('video'); setVideoHidden(!videoHidden) }}>{videoHidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>}</div></div>)}</div><div className="track-viewport" ref={trackViewportRef}><div className="tracks" ref={tracksRef} style={{ width: `${zoom}%` }}><div className="ruler" onPointerDown={beginScrub} onPointerMove={moveScrub} onPointerUp={() => { scrubbingRef.current = false }} onPointerCancel={() => { scrubbingRef.current = false }}>{Array.from({ length: rulerTicks }, (_, i) => i / (rulerTicks - 1)).map((part) => <span key={part} style={{ left: `${part * 100}%` }}>{formatTime(part * timelineDuration)}<i /></span>)}</div><div className="playhead" style={{ left: `${Math.min(position / timelineDuration * 100, 100)}%` }}><i /></div>{(['video', 'audio'] as const).map((track) => <div key={track} data-track-row={track} className={`track ${track}-track ${track === 'video' ? videoHidden ? 'track-disabled' : '' : audioMuted ? 'track-disabled' : ''}`} onPointerDown={(event) => { setSelectedTrack(track); beginScrub(event) }} onPointerMove={moveScrub} onPointerUp={() => { scrubbingRef.current = false }} onPointerCancel={() => { scrubbingRef.current = false }}>{edit[track].map((segment) => renderClip(track, segment))}</div>)}</div></div><div className="timeline-help">Select a track · Split twice, select middle, Remove · Audio-only cuts leave silence · Mute/visibility affect export</div></div></section>
  </main>
}
