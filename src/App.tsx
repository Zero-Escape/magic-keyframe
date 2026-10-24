import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AudioLines, ChevronDown, Clapperboard, Download, Eye, EyeOff, FolderOpen, FilePlus2, Save, KeyRound, Layers3, Link2, Unlink2, Pause, Play, Plus, Redo2, Scissors, SkipBack, SkipForward, Sparkles, Trash2, Undo2, Video, Volume2, VolumeX, WandSparkles, ZoomIn, ZoomOut } from 'lucide-react'

import { activeClip, endAt, linkedSelection, linkClips, unlinkClips, moveClips, removeClips, splitClips, trimClip, timelineEnd, ordered, type Track, type Segment, type TimelineEdit } from '../electron/timeline'
type MediaItem = ImportedMedia & { id: string; kind: Track }
type Edit = TimelineEdit
type Snapshot = { media: MediaItem[]; edit: Edit; videoMuted: boolean; audioMuted: boolean; videoHidden: boolean }
const emptySnapshot: Snapshot = { media: [], edit: { video: [], audio: [] }, videoMuted: false, audioMuted: false, videoHidden: false }
const fingerprint = (state: Snapshot) => JSON.stringify({ ...state, media: state.media.map(({ id, kind, path }) => ({ id, kind, path })) })
const formatTime = (seconds: number, precise = false) => {
  const whole = Math.max(0, Math.floor(seconds))
  const clock = `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
  return precise ? `${clock}.${String(Math.max(0, Math.floor((seconds - whole) * 100))).padStart(2, '0')}` : clock
}
const Waveform = memo(function Waveform({ data, start, end, left, width, viewport, scroll }: { data?: WaveformData; start: number; end: number; left: number; width: number; viewport: number; scroll: number }) {
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

export default function App() {
  const [media, setMedia] = useState<MediaItem[]>([])
  const [edit, setEdit] = useState<Edit>({ video: [], audio: [] })
  const [selectedTrack, setSelectedTrack] = useState<Track>('video')
  const [selection, setSelection] = useState<string[]>([])
  const [dragDuration, setDragDuration] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Record<Track, string | null>>({ video: null, audio: null })
  const [undoStack, setUndoStack] = useState<Snapshot[]>([])
  const [redoStack, setRedoStack] = useState<Snapshot[]>([])
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [projectPath, setProjectPath] = useState<string>()
  const [savedFingerprint, setSavedFingerprint] = useState(() => fingerprint(emptySnapshot))
  const [projectBusy, setProjectBusy] = useState(false)
  const [viewport, setViewport] = useState({ width: 1, scroll: 0 })
  const commandRef = useRef<(command: string, path?: string) => void>(() => {})
  const projectLockRef = useRef(false)
  const pendingCommandRef = useRef<{ command: string; path?: string } | null>(null)
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
  const clipDragRef = useRef<{ x: number; scroll: number; base: Edit; ids: string[]; moved: boolean; secondsPerPixel: number } | null>(null)
  const playerClipRef = useRef({ video: '', audio: '' })
  const trimDragRef = useRef<{ track: Track; id: string; edge: 'start' | 'end'; moved: boolean } | null>(null)
  const resizingRef = useRef<{ kind: 'sidebar' | 'timeline'; initial: number; x: number; y: number } | null>(null)
  const video = media.find((item) => item.kind === 'video')
  const audio = media.find((item) => item.kind === 'audio')
  const videoDuration = video?.metadata.duration || 0
  const audioDuration = audio?.metadata.duration || 0
  const projectDuration = timelineEnd(edit)
  const timelineDuration = dragDuration ?? Math.max(videoDuration, audioDuration, projectDuration, 1)
  const fps = video?.metadata.video?.fps || 29.97
  const frame = 1 / fps
  const currentSegments = edit[selectedTrack]
  const selectedSegment = currentSegments.find((item) => item.id === selectedIds[selectedTrack] && selection.includes(item.id)) || currentSegments.find((item) => selection.includes(item.id))
  const selectedOffset = selectedSegment ? selectedSegment.at - selectedSegment.start : 0
  const selectedClips = [...edit.video, ...edit.audio].filter((c) => selection.includes(c.id))
  const canSplit = selectedClips.some((item) => position > item.at + frame / 2 && position < endAt(item) - frame / 2)
  const canUnlink = selectedClips.some((c) => c.linkId)
  const canLink = selectedClips.length > 1 && (!selectedClips[0].linkId || selectedClips.some((c) => c.linkId !== selectedClips[0].linkId))
  const rulerTicks = Math.min(240, Math.max(7, Math.round(7 * zoom / 100)))
  const pictureVisible = !!video && !videoHidden && !!activeClip(edit.video, position)

  useEffect(() => { if (selectedSegment) setTrimDraft({ start: selectedSegment.start.toFixed(3), end: selectedSegment.end.toFixed(3) }) }, [selectedTrack, selectedSegment?.id, selectedSegment?.start, selectedSegment?.end])
  const snapshot: Snapshot = { media, edit, videoMuted, audioMuted, videoHidden }
  const contentFingerprint = fingerprint(snapshot)
  const dirty = contentFingerprint !== savedFingerprint
  const title = projectPath?.split(/[\\/]/).pop()?.replace(/\.mkproj$/i, '') || 'Untitled Wedding'
  const restore = (state: Snapshot) => {
    setPlaying(false); setMedia(state.media); setEdit(state.edit); setVideoMuted(state.videoMuted); setAudioMuted(state.audioMuted); setVideoHidden(state.videoHidden)
    setSelectedIds({ video: null, audio: null }); setSelection([]); setDragDuration(null); clipDragRef.current = null
    const nextDuration = Math.max(timelineEnd(state.edit), 1)
    const nextPosition = Math.min(positionRef.current, nextDuration)
    positionRef.current = nextPosition; setPosition(nextPosition); clockRef.current = { time: nextPosition, now: performance.now() }
  }
  const recordHistory = () => { setUndoStack((items) => [...items.slice(-99), snapshot]); setRedoStack([]) }
  const undo = () => { if (!undoStack.length) return; setRedoStack((items) => [...items, snapshot]); restore(undoStack[undoStack.length - 1]); setUndoStack((items) => items.slice(0, -1)) }
  const redo = () => { if (!redoStack.length) return; setUndoStack((items) => [...items, snapshot]); restore(redoStack[redoStack.length - 1]); setRedoStack((items) => items.slice(0, -1)) }
  useEffect(() => { window.magicKey?.setProjectDirty(dirty); document.title = `${dirty ? '● ' : ''}${title} — Magic Keyframe` }, [dirty, title])
  useEffect(() => {
    let canceled = false
    setProxyUrl(undefined)
    if (!video || !window.magicKey) { setProxying(false); return }
    setProxying(true)
    void window.magicKey.generateProxy(video.path).then((proxy) => {
      if (!canceled) { resumeAfterProxyRef.current = positionRef.current; setProxyUrl(proxy.url) }
    }).catch((error) => { if (!canceled) setNotice({ kind: 'error', message: `Proxy failed; original remains available. ${String(error)}` }) }).finally(() => { if (!canceled) setProxying(false) })
    return () => { canceled = true }
  }, [video?.id, video?.path])
  useEffect(() => {
    const node = trackViewportRef.current; if (!node) return
    const update = () => setViewport({ width: node.clientWidth, scroll: node.scrollLeft })
    const observer = new ResizeObserver(update); observer.observe(node); update()
    node.addEventListener('scroll', update)
    return () => { observer.disconnect(); node.removeEventListener('scroll', update) }
  }, [])
  const saveProject = async (saveAs = false) => {
    if (!window.magicKey) return false
    const project: ProjectData = { format: 'magic-keyframe-project', version: 2, media: media.map(({ id, kind, path }) => ({ id, kind, path })), edit, tracks: { videoMuted, audioMuted, videoHidden }, view: { position: positionRef.current, zoom, timelineHeight, sidebarWidth } }
    const path = await window.magicKey.saveProject(project, saveAs ? undefined : projectPath)
    if (!path) return false
    setProjectPath(path); setSavedFingerprint(contentFingerprint); setNotice({ kind: 'success', message: `Project saved: ${path}` }); return true
  }
  const confirmLeaving = async () => {
    if (!dirty) return true
    const answer = await window.magicKey!.confirmProject()
    return answer === 'discard' || (answer === 'save' && await saveProject())
  }
  const projectCommand = async (command: string, path?: string) => {
    if (projectLockRef.current || importLockRef.current || importing || exporting) {
      if (command === 'open' || command === 'close') pendingCommandRef.current = { command, path }
      return
    }
    if (['link', 'unlink', 'split', 'remove', 'selectAll'].includes(command)) {
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) { if (command === 'selectAll') active.select(); return }
      if (command === 'selectAll') setSelection([...edit.video, ...edit.audio].map((c) => c.id))
      else if (command === 'link') changeLinks(false)
      else if (command === 'unlink') changeLinks(true)
      else if (command === 'split') splitAtPlayhead()
      else removeSelected()
      return
    }
    if (command === 'undo' || command === 'redo') {
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) { document.execCommand(command); return }
      if (command === 'undo') undo(); else redo(); return
    }
    projectLockRef.current = true; setProjectBusy(true); setPlaying(false)
    try {
      if (command === 'save' || command === 'saveAs') { await saveProject(command === 'saveAs'); return }
      if (!await confirmLeaving()) return
      if (command === 'close') { window.magicKey?.closeProjectWindow(); return }
      if (command === 'new') {
        restore(emptySnapshot); setProjectPath(undefined); setSavedFingerprint(fingerprint(emptySnapshot)); setPosition(0); positionRef.current = 0; setZoom(100)
      } else if (command === 'open') {
        const result = await window.magicKey?.openProject(path)
        if (!result) return
        const state: Snapshot = { media: result.media, edit: result.project.edit, ...result.project.tracks }
        restore(state); setProjectPath(result.path); setSavedFingerprint(result.relinked ? 'relinked-media-needs-saving' : fingerprint(state))
        const view = result.project.view
        const duration = Math.max(result.media.find((m) => m.kind === 'video')?.metadata.duration || 0, result.media.find((m) => m.kind === 'audio')?.metadata.duration || 0, timelineEnd(state.edit), 1)
        const loadedPosition = Math.min(view.position, duration)
        setPosition(loadedPosition); positionRef.current = loadedPosition; resumeAfterProxyRef.current = loadedPosition
        setZoom(view.zoom); setTimelineHeight(Math.max(220, Math.min(window.innerHeight - 300, view.timelineHeight))); setSidebarWidth(view.sidebarWidth)
        requestAnimationFrame(() => { const node = trackViewportRef.current; if (node) node.scrollLeft = loadedPosition / duration * node.clientWidth * view.zoom / 100 - node.clientWidth / 2 })
      }
      setUndoStack([]); setRedoStack([]); setNotice(null)
      if (trackViewportRef.current) trackViewportRef.current.scrollLeft = 0
    } catch (error) { setNotice({ kind: 'error', message: `Project operation failed: ${String(error)}` }) }
    finally { projectLockRef.current = false; setProjectBusy(false) }
  }
  commandRef.current = (command, path) => { void projectCommand(command, path) }
  useEffect(() => {
    if (projectBusy || importing || exporting || projectLockRef.current || !pendingCommandRef.current) return
    const pending = pendingCommandRef.current; pendingCommandRef.current = null
    commandRef.current(pending.command, pending.path)
  }, [projectBusy, importing, exporting])
  useEffect(() => window.magicKey?.onCommand((command, path) => commandRef.current(command, path)), [])
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
      if (event.key === 'Escape') { setSelection([]); return }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); commandRef.current('remove'); return }
      if (!(event.ctrlKey || event.metaKey) || window.magicKey?.onCommand) return
      const key = event.key.toLowerCase()
      const command = key === 's' ? event.shiftKey ? 'saveAs' : 'save' : key === 'o' ? 'open' : key === 'n' ? 'new' : key === 'z' ? event.shiftKey ? 'redo' : 'undo' : key === 'y' ? 'redo' : key === 'l' ? event.shiftKey ? 'unlink' : 'link' : key === 'a' ? 'selectAll' : key === 'b' ? 'split' : null
      if (command) { event.preventDefault(); commandRef.current(command) }
    }
    window.addEventListener('keydown', keys); return () => window.removeEventListener('keydown', keys)
  }, [])
  const safePlay = (player: HTMLMediaElement) => {
    if (!player.paused || pendingPlayRef.current.has(player)) return
    pendingPlayRef.current.add(player)
    void player.play().catch(() => {}).finally(() => pendingPlayRef.current.delete(player))
  }
  const syncPlayers = (time: number, play: boolean, force = false) => {
    for (const track of ['video', 'audio'] as const) {
      const player = track === 'video' ? videoRef.current : audioRef.current
      const source = track === 'video' ? video : audio
      if (!player || !source) continue
      const clip = activeClip(edit[track], time)
      player.muted = (track === 'video' ? videoMuted : audioMuted) || !clip
      if (clip) {
        const wanted = clip.start + time - clip.at
        if (force || playerClipRef.current[track] !== clip.id || Math.abs(player.currentTime - wanted) > .12) player.currentTime = Math.max(0, wanted)
        playerClipRef.current[track] = clip.id
        if (play) safePlay(player); else player.pause()
      } else { player.pause(); playerClipRef.current[track] = '' }
    }
  }
  const seekTo = (time: number) => {
    const next = Math.max(0, Math.min(timelineDuration, time))
    positionRef.current = next; clockRef.current = { time: next, now: performance.now() }; setPosition(next)
    syncPlayers(next, playing, true)
  }
  useEffect(() => {
    if (!playing) { syncPlayers(positionRef.current, false, true); return }
    let request = 0, lastPaint = 0
    const tick = (now: number) => {
      const time = clockRef.current.time + (now - clockRef.current.now) / 1000
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
    if (projectDuration <= 0) return
    let start = positionRef.current
    if (start >= projectDuration - frame) start = 0
    playbackEndRef.current = projectDuration
    seekTo(start); syncPlayers(start, true, true); setPlaying(true)
  }
  const importMedia = async (paths?: string[]) => {
    if (!window.magicKey || importLockRef.current || projectLockRef.current) return
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
      if (!accepted.length) return
      setPlaying(false); recordHistory(); setMedia((items) => [...items, ...accepted])
      let nextEdit = edit
      for (const item of accepted) {
        const segment = { id: crypto.randomUUID(), start: 0, end: item.metadata.duration, at: 0 }
        nextEdit = { ...nextEdit, [item.kind]: [segment] }
        setSelectedIds((ids) => ({ ...ids, [item.kind]: segment.id })); setSelection([segment.id])
        if (item.kind === 'audio') setVideoMuted(true)
      }
      setEdit(nextEdit)
      const preferred = accepted.find((item) => item.kind === 'video') || accepted[0]
      if (preferred) { setSelectedTrack(preferred.kind); setSelection(nextEdit[preferred.kind].map((c) => c.id)) }
      if (!video && accepted.some((item) => item.kind === 'video')) { setSelectedTrack('video'); setZoom(100) }
      else if (!video && accepted.length) setSelectedTrack('audio')
      if (accepted.length < picked.length && accepted.length) setNotice({ kind: 'success', message: 'Imported the available tracks. Extra/duplicate files were skipped; this build uses one video and one external audio file.' })
    } catch (error) { setNotice({ kind: 'error', message: `Import failed: ${String(error)}` }) }
    finally { importLockRef.current = false; setImporting(false) }
  }
  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault(); dragDepthRef.current = 0; setDropping(false)
    try {
      const paths = Array.from(event.dataTransfer.files).map((file) => window.magicKey?.getPathForFile(file)).filter((path): path is string => !!path)
      if (paths.length === 1 && paths[0].toLowerCase().endsWith('.mkproj')) commandRef.current('open', paths[0])
      else if (paths.length) void importMedia(paths)
      else setNotice({ kind: 'error', message: 'Drop local media files from File Explorer.' })
    } catch (error) { setNotice({ kind: 'error', message: `Could not read dropped files: ${String(error)}` }) }
  }
  const handleExport = async () => {
    if (!video || !window.magicKey || !edit.video.length) return
    setExporting(true); setNotice(null)
    try {
      const result = await window.magicKey.exportVideo({ videoPath: video.path, audioPath: audio?.path, segments: edit.video, audioSegments: edit.audio, videoMuted, audioMuted, videoHidden })
      if (result.path) setNotice({ kind: 'success', message: `Export saved: ${result.path}` })
    } catch (error) { setNotice({ kind: 'error', message: `Export failed: ${String(error)}` }) }
    finally { setExporting(false) }
  }
  const splitAtPlayhead = () => {
    const result = splitClips(edit, selection, Math.round(position * fps) / fps, frame / 2)
    if (result.edit === edit) return
    setPlaying(false); recordHistory(); setEdit(result.edit); setSelection(result.selection)
  }
  const removeSelected = () => {
    if (!selection.length) return
    setPlaying(false); recordHistory(); setEdit(removeClips(edit, selection)); setSelection([])
  }
  const changeLinks = (unlink: boolean) => {
    if (unlink ? !canUnlink : !canLink) return
    recordHistory(); setEdit(unlink ? unlinkClips(edit, selection) : linkClips(edit, selection))
  }
  const nudgeSelection = (delta: number) => {
    const result = moveClips(edit, selection, delta)
    if (!result.delta) return
    setPlaying(false); recordHistory(); setEdit(result.edit)
  }
  const commitTrimInput = (edge: 'start' | 'end') => {
    if (!selectedSegment) return
    const value = Number(trimDraft[edge])
    if (!Number.isFinite(value)) return
    const next = trimClip(edit, selectedSegment.id, edge, Math.round(value * fps) / fps, selectedTrack === 'video' ? videoDuration : audioDuration, frame)
    if (JSON.stringify(next) === JSON.stringify(edit)) { setTrimDraft({ start: selectedSegment.start.toFixed(3), end: selectedSegment.end.toFixed(3) }); return }
    setPlaying(false); recordHistory(); setEdit(next)
  }
  const timelinePoint = (x: number) => { const bounds = tracksRef.current!.getBoundingClientRect(); return Math.max(0, Math.min(timelineDuration, (x - bounds.left) / bounds.width * timelineDuration)) }
  const beginScrub = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const clip = (event.target as Element).closest<HTMLElement>('[data-segment-id]')
    if (clip) return
    event.currentTarget.setPointerCapture(event.pointerId); scrubbingRef.current = true; seekTo(Math.round(timelinePoint(event.clientX) * fps) / fps)
  }
  const moveScrub = (event: React.PointerEvent) => { if (scrubbingRef.current) seekTo(Math.round(timelinePoint(event.clientX) * fps) / fps) }
  const beginTrim = (event: React.PointerEvent, track: Track, id: string, edge: 'start' | 'end') => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedTrack(track); setSelectedIds((ids) => ({ ...ids, [track]: id })); setSelection(linkedSelection(edit, [id])); trimDragRef.current = { track, id, edge, moved: false }
  }
  const moveTrim = (event: React.PointerEvent) => {
    event.stopPropagation(); const drag = trimDragRef.current; if (!drag) return
    const clip = edit[drag.track].find((c) => c.id === drag.id); if (!clip) return
    const value = clip.start + Math.round((timelinePoint(event.clientX) - clip.at) * fps) / fps
    const next = trimClip(edit, drag.id, drag.edge, value, drag.track === 'video' ? videoDuration : audioDuration, frame)
    if (JSON.stringify(next) === JSON.stringify(edit)) return
    if (!drag.moved) { setPlaying(false); recordHistory(); drag.moved = true }
    setEdit(next)
  }
  const beginClipDrag = (event: React.PointerEvent, track: Track, id: string) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedTrack(track); setSelectedIds((ids) => ({ ...ids, [track]: id }))
    const group = linkedSelection(edit, [id])
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    const next = additive ? selection.includes(id) ? selection.filter((chosen) => !group.includes(chosen)) : linkedSelection(edit, [...selection, ...group]) : selection.includes(id) ? linkedSelection(edit, selection) : group
    setSelection(next)
    if (!next.includes(id)) return
    setDragDuration(timelineDuration)
    clipDragRef.current = { x: event.clientX, scroll: trackViewportRef.current?.scrollLeft || 0, base: edit, ids: next, moved: false, secondsPerPixel: timelineDuration / tracksRef.current!.clientWidth }
  }
  const moveClipDrag = (event: React.PointerEvent) => {
    event.stopPropagation(); const drag = clipDragRef.current; if (!drag) return
    const pixels = event.clientX - drag.x + (trackViewportRef.current?.scrollLeft || 0) - drag.scroll
    if (!drag.moved && Math.abs(pixels) < 3) return
    const delta = Math.round(pixels * drag.secondsPerPixel * fps) / fps
    const result = moveClips(drag.base, drag.ids, delta, event.altKey ? 0 : 8 * drag.secondsPerPixel, positionRef.current)
    if (!drag.moved && !result.delta) return
    if (!drag.moved) { setPlaying(false); recordHistory(); drag.moved = true }
    setEdit(result.edit)
  }
  const endClipDrag = () => { clipDragRef.current = null; setDragDuration(null) }
  const changeZoom = (value: number) => { setZoom(value); requestAnimationFrame(() => { if (trackViewportRef.current && tracksRef.current) trackViewportRef.current.scrollLeft = position / timelineDuration * tracksRef.current.clientWidth - trackViewportRef.current.clientWidth / 2 }) }
  const beginResize = (event: React.PointerEvent, kind: 'sidebar' | 'timeline') => { event.currentTarget.setPointerCapture(event.pointerId); resizingRef.current = { kind, initial: kind === 'sidebar' ? sidebarWidth : timelineHeight, x: event.clientX, y: event.clientY } }
  const moveResize = (event: React.PointerEvent) => { const drag = resizingRef.current; if (!drag) return; if (drag.kind === 'sidebar') setSidebarWidth(Math.max(220, Math.min(560, drag.initial + event.clientX - drag.x))); else setTimelineHeight(Math.max(220, Math.min(window.innerHeight - 300, drag.initial + drag.y - event.clientY))) }
  useEffect(() => {
    const node = trackViewportRef.current, surface = node?.closest('.timeline-scroll'); if (!node || !surface) return
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) return
      event.preventDefault()
      if (clipDragRef.current || trimDragRef.current) return
      const bounds = node.getBoundingClientRect(), anchor = Math.max(0, Math.min(node.clientWidth, event.clientX - bounds.left))
      const fraction = (node.scrollLeft + anchor) / (node.clientWidth * zoom / 100)
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1)
      const next = Math.max(100, Math.min(4000, zoom * Math.exp(-delta * .002)))
      setZoom(next)
      requestAnimationFrame(() => { node.scrollLeft = fraction * node.clientWidth * next / 100 - anchor })
    }
    surface.addEventListener('wheel', wheel as EventListener, { passive: false }); return () => surface.removeEventListener('wheel', wheel as EventListener)
  }, [zoom])
  const selectTrack = (track: Track) => {
    setSelectedTrack(track)
    const clip = activeClip(edit[track], position) || edit[track][0]
    setSelection(clip ? linkedSelection(edit, [clip.id]) : [])
    setSelectedIds((ids) => ({ ...ids, [track]: clip?.id || null }))
  }
  const renderClip = (track: Track, segment: Segment) => {
    const item = track === 'video' ? video : audio; if (!item) return null

    return <div key={segment.id} data-track={track} data-segment-id={segment.id} className={`clip ${track}-clip draggable ${segment.linkId ? 'linked-clip' : ''} ${selection.includes(segment.id) ? 'selected' : ''}`} style={{ left: `${segment.at / timelineDuration * 100}%`, width: `${(segment.end - segment.start) / timelineDuration * 100}%` }} onPointerDown={(event) => beginClipDrag(event, track, segment.id)} onPointerMove={moveClipDrag} onPointerUp={endClipDrag} onPointerCancel={endClipDrag}>
      <span className="trim-handle left" title="Drag to trim start" onPointerDown={(event) => beginTrim(event, track, segment.id, 'start')} onPointerMove={moveTrim} onPointerUp={() => { trimDragRef.current = null }} onPointerCancel={() => { trimDragRef.current = null }} />
      <Waveform data={item.waveform} start={segment.start} end={segment.end} left={segment.at / timelineDuration * viewport.width * zoom / 100} width={(segment.end - segment.start) / timelineDuration * viewport.width * zoom / 100} viewport={viewport.width} scroll={viewport.scroll} />
      <div className="clip-title"><strong>{segment.linkId && <Link2 size={11} className="link-badge" />}{item.name}</strong><small>{formatTime(segment.start)} → {formatTime(segment.end)}</small></div>
      <span className="trim-handle right" title="Drag to trim end" onPointerDown={(event) => beginTrim(event, track, segment.id, 'end')} onPointerMove={moveTrim} onPointerUp={() => { trimDragRef.current = null }} onPointerCancel={() => { trimDragRef.current = null }} />
    </div>
  }
  return <main className="app-shell" style={{ '--timeline-height': `${timelineHeight}px`, '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepthRef.current++; setDropping(true) } }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
    onDragLeave={(event) => { event.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (!dragDepthRef.current) setDropping(false) }} onDrop={handleDrop}>
    {(projectBusy || importing) && <div className="project-busy">{importing ? 'Analysing media…' : 'Working on project…'}</div>}
    {dropping && <div className="drop-overlay"><FolderOpen size={42} /><strong>Drop media to import</strong><span>Local video or audio files · originals stay untouched</span></div>}
    <header className="topbar"><div className="brand"><span className="brand-mark"><KeyRound size={18} /></span><span>Magic Keyframe</span></div><div className="project-title"><span className="status-dot" /> {dirty ? '● ' : ''}{title}</div><div className="top-actions"><button className="icon-button" title="New project (Ctrl+N)" onClick={() => commandRef.current('new')}><FilePlus2 size={17} /></button><button className="icon-button" title="Open project (Ctrl+O)" onClick={() => commandRef.current('open')}><FolderOpen size={17} /></button><button className="icon-button" title="Save project (Ctrl+S); Save as: Ctrl+Shift+S" onClick={() => commandRef.current('save')}><Save size={17} /></button><button className="icon-button" title="Undo edit" onClick={undo} disabled={!undoStack.length}><Undo2 size={17} /></button><button className="icon-button" title="Redo edit" onClick={redo} disabled={!redoStack.length}><Redo2 size={17} /></button><button className="button primary" onClick={handleExport} disabled={!video || !edit.video.length || exporting}><Download size={16} />{exporting ? 'Exporting…' : 'Export'}</button></div></header>
    <section className="workspace"><aside className="media-panel panel"><div className="panel-heading"><div><span className="eyebrow">PROJECT</span><h2>Media</h2></div><button className="icon-button" onClick={() => void importMedia()} disabled={importing}><Plus size={18} /></button></div><button className="import-card" onClick={() => void importMedia()} disabled={importing}><span><FolderOpen size={21} /></span><strong>{importing ? 'Analysing media…' : 'Import footage'}</strong><small>Click or drop video and audio here</small></button><div className="media-list">{!media.length && <div className="empty-media"><Clapperboard size={25} /><p>Drop footage anywhere in the window.</p><small>Start with the camera video and matching recorder audio.</small></div>}{media.map((item) => <div className="media-item" key={item.id}><span className={`media-icon ${item.kind}`}>{item.thumbnail ? <img src={item.thumbnail} alt={`${item.kind === 'video' ? 'Frame' : 'Waveform'} preview of ${item.name}`} /> : item.kind === 'video' ? <Video size={16} /> : <AudioLines size={16} />}</span><span className="media-copy"><strong>{item.name}</strong><small>{item.metadata.video ? `${item.metadata.video.width}×${item.metadata.video.height} · ${item.metadata.video.fps?.toFixed(2)} fps` : `${(item.metadata.audio?.sampleRate || 0) / 1000} kHz · ${item.metadata.audio?.channels === 1 ? 'Mono' : 'Stereo'}`}</small></span></div>)}</div><div className="assistant-card"><WandSparkles size={18} /><div><strong>Track monitoring</strong><small>Mute each source independently to compare sync.</small></div></div></aside>
      <section className="viewer-panel panel"><div className="viewer-heading"><span>Preview</span><span className="quality-pill">{proxying ? 'BUILDING PROXY…' : proxyUrl ? 'PROXY · 1080P' : 'ORIGINAL'}<ChevronDown size={12} /></span></div>{notice && <div className={`status-banner ${notice.kind}`}><span>{notice.message}</span><button title="Dismiss message" onClick={() => setNotice(null)}>×</button></div>}<div className="viewer">{video ? <><video ref={videoRef} src={proxyUrl || video.url} style={{ visibility: pictureVisible ? 'visible' : 'hidden' }} muted={videoMuted} onLoadedMetadata={() => { syncPlayers(resumeAfterProxyRef.current ?? positionRef.current, playing, true); resumeAfterProxyRef.current = null }} />{!pictureVisible && <div className="hidden-video-notice"><EyeOff size={24} /><span>{videoHidden ? 'Video 1 hidden' : 'No video at this position'}</span></div>}</> : <div className="viewer-empty"><span className="glow"><Sparkles size={30} /></span><h1>{audio ? 'Audio is ready to edit' : 'Your story starts here'}</h1><p>{audio ? 'Select Audio 1 to trim, split, or remove sections.' : 'Import or drop your footage to begin.'}</p><button className="button primary" onClick={() => void importMedia()}><Plus size={16} /> Add media</button></div>}<audio ref={audioRef} src={audio?.url} onLoadedMetadata={() => syncPlayers(positionRef.current, playing, true)} muted={audioMuted || !activeClip(edit.audio, position)} /></div><div className="transport"><span className="timecode">{formatTime(position, true)}<em> / {formatTime(projectDuration, true)}</em></span><div className="transport-controls"><button title="Previous cut" onClick={() => seekTo([...ordered(currentSegments)].reverse().find((item) => item.at < position - frame)?.at || 0)}><SkipBack size={18} /></button><button className="play-button" onClick={togglePlayback}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button title="Next cut" onClick={() => seekTo(ordered(currentSegments).find((item) => item.at > position + frame)?.at ?? projectDuration)}><SkipForward size={18} /></button></div><div className="volume"><Volume2 size={17} /><span><i /></span></div></div></section>
      <div className="sidebar-resizer" title="Drag to resize media panel" onPointerDown={(event) => beginResize(event, 'sidebar')} onPointerMove={moveResize} onPointerUp={() => { resizingRef.current = null }} onPointerCancel={() => { resizingRef.current = null }} /></section>
    <section className="timeline-panel panel"><div className="timeline-resizer" title="Drag to resize timeline" onPointerDown={(event) => beginResize(event, 'timeline')} onPointerMove={moveResize} onPointerUp={() => { resizingRef.current = null }} onPointerCancel={() => { resizingRef.current = null }} /><div className="timeline-tools"><div className="tool-group"><span className={`tool active ${selectedTrack === 'audio' ? 'audio-selection' : ''}`}><Layers3 size={16} />{selection.length > 1 ? `${selection.length} clips` : selectedTrack === 'video' ? 'Video 1' : 'Audio 1'}</span><button className="tool" title="Split selected clips and their linked partners at the playhead" onClick={splitAtPlayhead} disabled={!canSplit}><Scissors size={16} /> Split</button><button className="tool remove-tool" title="Remove selected clips and linked partners; gaps stay in place" onClick={removeSelected} disabled={!selection.length}><Trash2 size={15} /> Remove</button><button className="tool" title="Link selected clips to preserve sync when moving and splitting (Ctrl+L)" disabled={!canLink} onClick={() => changeLinks(false)}><Link2 size={15} /> Link</button><button className="tool" title="Unlink selected clips (Ctrl+Shift+L)" disabled={!canUnlink} onClick={() => changeLinks(true)}><Unlink2 size={15} /> Unlink</button></div><div className="edit-controls"><div className="align-controls" title="Nudge selected clips; the value is the active clip’s timeline offset from its source"><button onClick={() => nudgeSelection(-frame)} disabled={!selection.length}>−1 frame</button><span>{selectedOffset >= 0 ? '+' : ''}{selectedOffset.toFixed(3)}s</span><button onClick={() => nudgeSelection(frame)} disabled={!selection.length}>+1 frame</button></div><div className="trim-inputs">{(['start', 'end'] as const).map((edge) => <label key={edge}>{edge === 'start' ? 'IN' : 'OUT'}<input aria-label={`${edge === 'start' ? 'In' : 'Out'} point in source seconds`} type="number" step={frame} value={trimDraft[edge]} disabled={!selectedSegment} onChange={(event) => setTrimDraft((current) => ({ ...current, [edge]: event.target.value }))} onBlur={() => commitTrimInput(edge)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>)}</div></div><div className="zoom"><button title="Fit full timeline" onClick={() => changeZoom(100)}>Fit</button><ZoomOut size={16} /><input aria-label="Timeline zoom" type="range" min="100" max="4000" step="50" value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} /><ZoomIn size={16} /><span>{Math.round(zoom / 100)}×</span></div></div>
      <div className="timeline-scroll"><div className="track-labels"><div className="ruler-spacer" />{(['video', 'audio'] as const).map((track) => <div key={track} className={`track-header ${selectedTrack === track ? 'selected-track' : ''}`} onClick={() => selectTrack(track)}><button className="track-select" onClick={() => selectTrack(track)}>{track === 'video' ? <Video size={14} /> : <AudioLines size={14} />}<span>{track === 'video' ? 'VIDEO 1' : 'AUDIO 1'}</span></button><div className="track-switches"><button aria-label={`${track === 'video' ? videoMuted ? 'Unmute' : 'Mute' : audioMuted ? 'Unmute' : 'Mute'} ${track === 'video' ? 'Video 1' : 'Audio 1'}`} title="Mute affects preview and export" aria-pressed={track === 'video' ? videoMuted : audioMuted} className={(track === 'video' ? videoMuted : audioMuted) ? 'switch-off' : ''} disabled={track === 'video' ? !video : !audio} onClick={(event) => { event.stopPropagation(); setSelectedTrack(track); recordHistory(); if (track === 'video') setVideoMuted(!videoMuted); else setAudioMuted(!audioMuted) }}>{(track === 'video' ? videoMuted : audioMuted) ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>{track === 'video' && <button aria-label={videoHidden ? 'Show Video 1' : 'Hide Video 1'} title="Video visibility affects preview and export; audio is separate" aria-pressed={videoHidden} className={videoHidden ? 'switch-off' : ''} disabled={!video} onClick={(event) => { event.stopPropagation(); setSelectedTrack('video'); recordHistory(); setVideoHidden(!videoHidden) }}>{videoHidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>}</div></div>)}</div><div className="track-viewport" ref={trackViewportRef}><div className="tracks" ref={tracksRef} style={{ width: `${zoom}%` }}><div className="ruler" onPointerDown={beginScrub} onPointerMove={moveScrub} onPointerUp={() => { scrubbingRef.current = false }} onPointerCancel={() => { scrubbingRef.current = false }}>{Array.from({ length: rulerTicks }, (_, i) => i / (rulerTicks - 1)).map((part) => <span key={part} style={{ left: `${part * 100}%` }}>{formatTime(part * timelineDuration)}<i /></span>)}</div><div className="playhead" style={{ left: `${Math.min(position / timelineDuration * 100, 100)}%` }}><i /></div>{(['video', 'audio'] as const).map((track) => <div key={track} data-track-row={track} className={`track ${track}-track ${track === 'video' ? videoHidden ? 'track-disabled' : '' : audioMuted ? 'track-disabled' : ''}`} onPointerDown={(event) => { setSelectedTrack(track); beginScrub(event) }} onPointerMove={moveScrub} onPointerUp={() => { scrubbingRef.current = false }} onPointerCancel={() => { scrubbingRef.current = false }}>{edit[track].map((segment) => renderClip(track, segment))}</div>)}</div></div><div className="timeline-help">Ctrl/Shift+click: multi-select · Link: preserve sync · Split links both tracks · Drag edges snap (Alt: disable) · Wheel: zoom</div></div></section>
  </main>
}
