import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AudioLines, Download, Eye, EyeOff, FilePlus2, FolderOpen, KeyRound, Link2, Pause, Play, Plus, Redo2, Save, Scissors, SkipBack, SkipForward, Trash2, Undo2, Unlink2, Video, Volume2, VolumeX, WandSparkles } from 'lucide-react'
import { activeClip, emptyEdit, endAt, linkedSelection, linkClips, moveClips, ordered, removeClips, splitClips, timelineEnd, trimClip, unlinkClips, type Segment, type TimelineEdit, type Track } from '../electron/timeline'
import { effects, defaultEffects, type ClipEffects } from '../electron/effects'
import type { MediaItem, Snapshot } from './editor-types'
import { Preview, AudioMixer, Meter } from './Preview'
import { EffectsPanel, type SyncCandidate } from './EffectsPanel'
import { Waveform } from './Waveform'

const empty = (): Snapshot => ({ media: [], edit: emptyEdit() })
const fingerprint = (state: Snapshot) => JSON.stringify({ edit: state.edit, media: state.media.map(({ id, kind, path }) => ({ id, kind, path })) })
const clock = (seconds: number, precise = false) => {
  const whole = Math.floor(Math.max(0, seconds)), value = `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
  return precise ? `${value}.${String(Math.floor(Math.max(0, seconds - whole) * 100)).padStart(2, '0')}` : value
}
const overlaps = (a: Segment, b: Segment) => a.at < endAt(b) - 1e-7 && endAt(a) > b.at + 1e-7

export default function App() {
  const [state, setState] = useState<Snapshot>(empty), { media, edit } = state
  const [selection, setSelection] = useState<string[]>([]), [focusId, setFocusId] = useState('')
  const [activeLane, setActiveLane] = useState<{ kind: Track; lane: number }>({ kind: 'video', lane: 0 })
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]), [redoStack, setRedoStack] = useState<Snapshot[]>([])
  const [playing, setPlaying] = useState(false), [position, setPosition] = useState(0), [zoom, setZoom] = useState(100)
  const [projectPath, setProjectPath] = useState<string>(), [savedFingerprint, setSavedFingerprint] = useState(() => fingerprint(empty()))
  const [busy, setBusy] = useState(''), [exporting, setExporting] = useState(false), [dropping, setDropping] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; message: string } | null>(null)
  const [tab, setTab] = useState<'media' | 'effects'>('media'), [draft, setDraft] = useState<{ id: string; value: ClipEffects }>()
  const [proxies, setProxies] = useState<Record<string, string>>({}), [proxyErrors, setProxyErrors] = useState<Record<string, string>>({})
  const [timelineHeight, setTimelineHeight] = useState(380), [sidebarWidth, setSidebarWidth] = useState(320)
  const [viewport, setViewport] = useState({ width: 1, scroll: 0 }), [dragDuration, setDragDuration] = useState<number | null>(null)
  const [trimDraft, setTrimDraft] = useState({ start: '0.000', end: '0.000' }), [quality, setQuality] = useState<'2160p' | '1080p'>('2160p')
  const [recoveries, setRecoveries] = useState<RecoveryInfo[]>([]), [autosaved, setAutosaved] = useState<number | null>(null)
  const [syncBusy, setSyncBusy] = useState(false), [candidate, setCandidate] = useState<SyncCandidate | null>(null), [audition, setAudition] = useState<TimelineEdit | null>(null)
  const [mixer, setMixer] = useState<AudioMixer | null>(null)
  const mixerRef = useRef<AudioMixer | null>(null), session = useRef<string>(crypto.randomUUID())
  const operation = useRef(false), pendingCommand = useRef<{ command: string; path?: string } | null>(null)
  const commands = useRef<(command: string, path?: string) => void>(() => {}), autosaveNow = useRef<() => Promise<void>>(async () => {})
  const priorCleanState = useRef<{ dirty: boolean; path?: string; session: string }>({ dirty: false, session: session.current })
  const autosavePromise = useRef<Promise<void> | null>(null), lastAutosaved = useRef('')
  const proxyAttempted = useRef(new Set<string>()), proxyInFlight = useRef(new Set<string>())
  const positionRef = useRef(0), playClock = useRef({ time: 0, now: 0 }), playbackEnd = useRef(0)
  const tracksRef = useRef<HTMLDivElement>(null), viewportRef = useRef<HTMLDivElement>(null), dragDepth = useRef(0), scrubbing = useRef(false)
  const clipDrag = useRef<{ x: number; scroll: number; base: Snapshot; ids: string[]; moved: boolean; scale: number; collapse?: string[] } | null>(null)
  const trimDrag = useRef<{ kind: Track; id: string; edge: 'start' | 'end'; moved: boolean } | null>(null)
  const fadeDrag = useRef<{ id: string; edge: 'fadeIn' | 'fadeOut'; x: number; scroll: number; scale: number; initial: number; max: number; base: Snapshot; moved: boolean } | null>(null)
  const [activeFade, setActiveFade] = useState<string | null>(null)
  const resizing = useRef<{ kind: 'sidebar' | 'timeline'; initial: number; x: number; y: number } | null>(null)
  const fp = fingerprint(state), dirty = fp !== savedFingerprint, projectDuration = timelineEnd(edit)
  const timelineDuration = dragDuration ?? Math.max(projectDuration, 1)
  const live = useRef({ state, fp, dirty, projectPath }); live.current = { state, fp, dirty, projectPath }
  const selectedClips = [...edit.video, ...edit.audio].filter((c) => selection.includes(c.id))
  const selected = selectedClips.find((c) => c.id === focusId) || selectedClips[0]
  const selectedKind: Track = selected && edit.audio.some((c) => c.id === selected.id) ? 'audio' : 'video'
  const selectedMedia = selected && media.find((m) => m.id === selected.mediaId)
  const fps = media.find((m) => m.kind === 'video' && edit.video.some((c) => c.mediaId === m.id))?.metadata.video?.fps || 29.97, frame = 1 / fps
  const canSplit = selectedClips.some((c) => position > c.at + frame / 2 && position < endAt(c) - frame / 2)
  const canUnlink = selectedClips.some((c) => c.linkId), canLink = selectedClips.length > 1 && (!selectedClips[0].linkId || selectedClips.some((c) => c.linkId !== selectedClips[0].linkId))
  const title = projectPath?.split(/[\\/]/).pop()?.replace(/\.mkproj$/i, '') || 'Untitled Wedding'
  const rows = [...edit.lanes.video.map((lane, index) => ({ kind: 'video' as Track, lane, index })).reverse(), ...edit.lanes.audio.map((lane, index) => ({ kind: 'audio' as Track, lane, index }))]
  const viewEdit = audition || edit
  const fail = (message: string, error?: unknown) => setNotice({ kind: 'error', message: `${message}${error ? ` ${String(error)}` : ''}` })
  const stop = () => { setPlaying(false); setAudition(null) }
  const record = (snapshot = state) => { setUndoStack((items) => [...items.slice(-99), snapshot]); setRedoStack([]) }
  const commit = (next: Snapshot, pause = true) => { if (fingerprint(next) === fp) return; if (pause) stop(); record(); setState(next) }
  const commitEdit = (next: TimelineEdit, pause = true) => commit({ media, edit: next }, pause)
  const restore = (next: Snapshot) => { stop(); setState(next); setSelection([]); setFocusId(''); setActiveLane({ kind: 'video', lane: 0 }); setDraft(undefined); setCandidate(null); clipDrag.current = null; trimDrag.current = null; fadeDrag.current = null; setActiveFade(null); setDragDuration(null) }
  const undo = () => { if (!undoStack.length) return; setRedoStack((s) => [...s, state]); restore(undoStack.at(-1)!); setUndoStack((s) => s.slice(0, -1)) }
  const redo = () => { if (!redoStack.length) return; setUndoStack((s) => [...s, state]); restore(redoStack.at(-1)!); setRedoStack((s) => s.slice(0, -1)) }
  const draftChanged = useCallback((value?: { id: string; value: ClipEffects }) => setDraft(value), [])
  const project = (): ProjectData => ({ format: 'magic-keyframe-project', version: 3, media: media.map(({ id, kind, path }) => ({ id, kind, path })), edit, view: { position: positionRef.current, zoom, timelineHeight, sidebarWidth } })
  const projectRef = useRef(project()); projectRef.current = project()

  useEffect(() => { document.title = `${dirty ? '● ' : ''}${title} — Magic Keyframe`; window.magicKey?.setProjectDirty(dirty) }, [dirty, title])
  useEffect(() => { setTrimDraft({ start: (selected?.start || 0).toFixed(3), end: (selected?.end || 0).toFixed(3) }) }, [selected?.id, selected?.start, selected?.end])
  useEffect(() => { if (candidate && candidate.fingerprint !== fp) { setCandidate(null); setAudition(null) } }, [fp])
  useEffect(() => {
    if (!window.magicKey) return
    const queue = media.filter((m) => m.kind === 'video' && !proxyAttempted.current.has(`${m.id}:${m.path}`))
    for (const item of queue) {
      const key = `${item.id}:${item.path}`; proxyAttempted.current.add(key); proxyInFlight.current.add(key)
      void window.magicKey.generateProxy(item.path).then((result) => {
        if (live.current.state.media.some((m) => m.id === item.id && m.path === item.path)) setProxies((s) => ({ ...s, [item.id]: result.url }))
      }).catch((error) => setProxyErrors((s) => ({ ...s, [item.id]: String(error) }))).finally(() => proxyInFlight.current.delete(key))
    }
  }, [media])
  useEffect(() => {
    const node = viewportRef.current; if (!node) return
    const update = () => setViewport({ width: node.clientWidth, scroll: node.scrollLeft })
    const observer = new ResizeObserver(update); observer.observe(node); node.addEventListener('scroll', update); update()
    return () => { observer.disconnect(); node.removeEventListener('scroll', update) }
  }, [])
  const seek = (time: number) => { const next = Math.max(0, Math.min(timelineDuration, time)); positionRef.current = next; setPosition(next); playClock.current = { time: next, now: performance.now() } }
  useEffect(() => {
    if (!playing) return
    let request = 0, lastPaint = 0
    const tick = (now: number) => {
      const time = playClock.current.time + (now - playClock.current.now) / 1000
      if (time >= playbackEnd.current) { positionRef.current = playbackEnd.current; setPosition(playbackEnd.current); setPlaying(false); setAudition(null); return }
      positionRef.current = time
      if (now - lastPaint >= 33) { setPosition(time); lastPaint = now }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick); return () => cancelAnimationFrame(request)
  }, [playing])
  useEffect(() => {
    if (!playing) return
    const visible = viewEdit.video.filter((c) => !viewEdit.lanes.video[c.lane].hidden && position >= c.at && position < endAt(c)).sort((a, b) => b.lane - a.lane)[0]
    if (visible && !proxies[visible.mediaId]) { stop(); fail('Video proxy is still preparing. Wait for it before playing, or hide that video track to audition audio.') }
  }, [playing, position, proxies])
  const ensureMixer = () => { if (!mixerRef.current) { mixerRef.current = new AudioMixer(); setMixer(mixerRef.current) }; void mixerRef.current.context.resume() }
  const togglePlay = () => {
    if (playing) { stop(); return }
    if (projectDuration <= 0) return
    ensureMixer(); const start = positionRef.current >= projectDuration - frame ? 0 : positionRef.current
    seek(start); playbackEnd.current = projectDuration; setPlaying(true)
  }

  autosaveNow.current = async () => {
    if (!window.magicKey || operation.current || !live.current.dirty || lastAutosaved.current === live.current.fp || autosavePromise.current) return
    const expected = live.current.fp, source = live.current.projectPath, currentSession = session.current, data = projectRef.current
    const pending = (async () => {
      try { const time = await window.magicKey!.autosave(data, source, currentSession); lastAutosaved.current = expected; setAutosaved(time) }
      catch (error) { fail('Autosave failed; save a manual project copy.', error) }
    })()
    autosavePromise.current = pending; await pending; autosavePromise.current = null
  }
  useEffect(() => {
    const before = priorCleanState.current, currentSession = session.current
    priorCleanState.current = { dirty, path: projectPath, session: currentSession }
    if (before.dirty && !dirty && before.path === projectPath && before.session === currentSession) {
      lastAutosaved.current = ''; setAutosaved(null)
      void (async () => {
        await autosavePromise.current
        if (!live.current.dirty && live.current.projectPath === projectPath && session.current === currentSession) await window.magicKey?.discardRecovery(projectPath, currentSession)
      })().catch((error) => fail('Could not clear an obsolete recovery copy.', error))
    }
  }, [dirty, projectPath])
  useEffect(() => { const timer = setTimeout(() => void autosaveNow.current(), 5000); return () => clearTimeout(timer) }, [fp])
  useEffect(() => { const timer = setInterval(() => void autosaveNow.current(), 30000); return () => clearInterval(timer) }, [])
  useEffect(() => { void window.magicKey?.recoveries().then(setRecoveries).catch((error) => fail('Could not inspect recovery files.', error)) }, [])
  const save = async (as = false) => {
    if (!window.magicKey) return false
    await autosavePromise.current
    const path = await window.magicKey.saveProject(project(), as ? undefined : projectPath)
    if (!path) return false
    await window.magicKey.discardRecovery(projectPath, session.current)
    setProjectPath(path); setSavedFingerprint(fp); setNotice({ kind: 'success', message: `Project saved: ${path}` }); return true
  }
  const confirmLeaving = async () => {
    if (!dirty) return true
    const answer = await window.magicKey!.confirmProject()
    if (answer === 'save') return save()
    if (answer === 'discard') { await autosavePromise.current; await window.magicKey!.discardRecovery(projectPath, session.current); return true }
    return false
  }
  const changeLinks = (unlink: boolean) => { if (unlink ? canUnlink : canLink) commitEdit(unlink ? unlinkClips(edit, selection) : linkClips(edit, selection), false) }
  const split = () => { const result = splitClips(edit, selection, Math.round(position * fps) / fps, frame / 2); if (result.edit !== edit) { commitEdit(result.edit); setSelection(result.selection); setFocusId(result.selection[0] || '') } }
  const remove = () => { if (selection.length) { commitEdit(removeClips(edit, selection)); setSelection([]) } }
  const nudge = (delta: number) => { const result = moveClips(edit, selection, delta); if (result.delta) commitEdit(result.edit); else if (selection.length) setNotice({ kind: 'success', message: 'Clip move blocked by the timeline start or a neighbouring clip. Unlink or select the adjacent clips to move them together.' }) }
  const stepFrame = (direction: number) => { stop(); seek((Math.round(positionRef.current * fps) + direction) / fps) }
  const command = async (name: string, path?: string) => {
    if (name === 'loadStatus') { if (operation.current) setBusy(path || 'Opening project…'); return }
    if (operation.current || (exporting && ['new', 'open', 'recover', 'close'].includes(name))) { if (name === 'open' || name === 'close') pendingCommand.current = { command: name, path }; return }
    const active = document.activeElement
    if (['undo', 'redo', 'selectAll', 'split', 'remove', 'link', 'unlink'].includes(name)) {
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) { if (name === 'selectAll') active.select(); else if (name === 'undo' || name === 'redo') document.execCommand(name); return }
      if (name === 'undo') undo(); else if (name === 'redo') redo(); else if (name === 'selectAll') setSelection([...edit.video, ...edit.audio].map((c) => c.id)); else if (name === 'split') split(); else if (name === 'remove') remove(); else changeLinks(name === 'unlink')
      return
    }
    operation.current = true; setBusy('Working on project…'); stop()
    try {
      if (name === 'save' || name === 'saveAs') { await save(name === 'saveAs'); return }
      if (!await confirmLeaving()) return
      if (name === 'close') { window.magicKey?.closeProjectWindow(); return }
      if (name === 'new') { restore(empty()); setProjectPath(undefined); setSavedFingerprint(fingerprint(empty())); session.current = crypto.randomUUID(); positionRef.current = 0; setPosition(0); setZoom(100) }
      else if (name === 'open' || name === 'recover') {
        const loaded = name === 'recover' ? await window.magicKey?.recoverProject(path!) : await window.magicKey?.openProject(path)
        if (!loaded) return
        const next = { media: loaded.media, edit: loaded.project.edit }
        restore(next); setProxies({}); proxyAttempted.current.clear(); setProxyErrors({}); setProjectPath(loaded.path)
        setSavedFingerprint(loaded.recovered || loaded.relinked ? 'needs-save' : fingerprint(next)); session.current = loaded.session || crypto.randomUUID()
        const v = loaded.project.view, end = Math.max(timelineEnd(next.edit), 1), time = Math.min(v.position, end)
        setPosition(time); positionRef.current = time; setZoom(v.zoom); setTimelineHeight(Math.max(220, Math.min(window.innerHeight - 300, v.timelineHeight))); setSidebarWidth(v.sidebarWidth)
        if (loaded.recovered) setRecoveries((s) => s.filter((r) => r.file !== path))
        requestAnimationFrame(() => { const node = viewportRef.current; if (node) node.scrollLeft = time / end * node.clientWidth * v.zoom / 100 - node.clientWidth / 2 })
      }
      setUndoStack([]); setRedoStack([]); setNotice(null); lastAutosaved.current = ''; setAutosaved(null)
    } catch (error) { fail('Project operation failed.', error) }
    finally { operation.current = false; setBusy('') }
  }
  commands.current = (name, path) => { void command(name, path) }
  useEffect(() => window.magicKey?.onCommand((name, path) => commands.current(name, path)), [])
  useEffect(() => { if (!busy && !exporting && !operation.current && pendingCommand.current) { const pending = pendingCommand.current; pendingCommand.current = null; commands.current(pending.command, pending.path) } }, [busy, exporting])
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !operation.current) { event.preventDefault(); if (event.altKey) nudge(event.key === 'ArrowLeft' ? -frame : frame); else stepFrame(event.key === 'ArrowLeft' ? -1 : 1); return }
      if (event.key === 'Escape') { setSelection([]); setDraft(undefined); stop(); return }
      if (event.key === ' ' && !operation.current) { event.preventDefault(); togglePlay(); return }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); commands.current('remove'); return }
      if (!(event.ctrlKey || event.metaKey) || window.magicKey?.onCommand) return
      const key = event.key.toLowerCase(), name = key === 's' ? event.shiftKey ? 'saveAs' : 'save' : key === 'o' ? 'open' : key === 'n' ? 'new' : key === 'z' ? event.shiftKey ? 'redo' : 'undo' : key === 'y' ? 'redo' : key === 'l' ? event.shiftKey ? 'unlink' : 'link' : key === 'a' ? 'selectAll' : key === 'b' ? 'split' : null
      if (name) { event.preventDefault(); commands.current(name) }
    }
    window.addEventListener('keydown', keys); return () => window.removeEventListener('keydown', keys)
  })

  const addLane = (kind: Track) => {
    if (edit.lanes[kind].length >= 16) { fail('This build supports up to 16 tracks of each kind.'); return }
    const index = edit.lanes[kind].length
    commitEdit({ ...edit, lanes: { ...edit.lanes, [kind]: [...edit.lanes[kind], { name: `${kind === 'video' ? 'Video' : 'Audio'} ${index + 1}`, muted: kind === 'video' && edit.lanes.video.every((l) => l.muted), hidden: false }] } })
    setActiveLane({ kind, lane: index })
  }
  const place = (base: TimelineEdit, item: MediaItem, at: number, preferredLane: number) => {
    let next = base, lane = Math.min(preferredLane, base.lanes[item.kind].length - 1)
    const clip: Segment = { id: crypto.randomUUID(), mediaId: item.id, lane, start: 0, end: item.metadata.duration, at: Math.max(0, at) }
    if (base[item.kind].some((c) => c.lane === lane && overlaps(c, clip))) {
      lane = base.lanes[item.kind].length
      if (lane >= 16) throw new Error('No free track; add the clip at an empty position.')
      next = { ...base, lanes: { ...base.lanes, [item.kind]: [...base.lanes[item.kind], { name: `${item.kind === 'video' ? 'Video' : 'Audio'} ${lane + 1}`, muted: item.kind === 'video' && base.lanes.video.every((l) => l.muted), hidden: false }] } }; clip.lane = lane
    }
    return { edit: { ...next, [item.kind]: [...next[item.kind], clip] }, clip }
  }
  const importMedia = async (paths?: string[]) => {
    if (!window.magicKey || operation.current || exporting) return
    operation.current = true; setBusy('Importing and analysing media…'); stop(); setNotice(null)
    try {
      const picked = paths ? await window.magicKey.importMedia(paths) : await window.magicKey.chooseMedia()
      const accepted = picked.filter((p) => !media.some((m) => m.path.toLowerCase() === p.path.toLowerCase())).map((p): MediaItem => ({ ...p, id: crypto.randomUUID(), kind: p.metadata.video ? 'video' : 'audio' }))
      if (!accepted.length) { if (picked.length) setNotice({ kind: 'success', message: 'Those files are already imported. Use their + buttons to add more copies to the timeline.' }); return }
      if (media.length + accepted.length > 200) throw new Error('This build supports up to 200 imported files.')
      let next = edit, last: Segment | undefined
      for (const item of accepted) {
        const at = Math.max(0, ...next[item.kind].filter((c) => c.lane === 0).map(endAt)), result = place(next, item, at, 0)
        next = result.edit; last = result.clip
      }
      if (!edit.audio.length && accepted.some((m) => m.kind === 'audio')) next = { ...next, lanes: { ...next.lanes, video: next.lanes.video.map((l) => ({ ...l, muted: true })) } }
      commit({ media: [...media, ...accepted], edit: next }); if (last) { setSelection([last.id]); setFocusId(last.id); setActiveLane({ kind: accepted.at(-1)!.kind, lane: last.lane }) }
      setNotice({ kind: 'success', message: 'Imported files were added in sequence on track 1. Use + on a media item to add another copy at the playhead; occupied positions use a new track.' })
    } catch (error) { fail('Import failed.', error) }
    finally { operation.current = false; setBusy('') }
  }
  const addMedia = (item: MediaItem) => { try { const result = place(edit, item, positionRef.current, activeLane.kind === item.kind ? activeLane.lane : 0); commitEdit(result.edit); setSelection([result.clip.id]); setFocusId(result.clip.id); setActiveLane({ kind: item.kind, lane: result.clip.lane }) } catch (error) { fail('Could not add clip.', error) } }
  const drop = (event: React.DragEvent) => {
    event.preventDefault(); dragDepth.current = 0; setDropping(false)
    try { const files = [...event.dataTransfer.files].map((file) => window.magicKey?.getPathForFile(file)).filter((p): p is string => !!p); if (files.length === 1 && files[0].toLowerCase().endsWith('.mkproj')) commands.current('open', files[0]); else if (files.length) void importMedia(files) } catch (error) { fail('Could not read dropped files.', error) }
  }
  const exportVideo = async () => {
    if (!window.magicKey || !edit.video.length || operation.current) return
    stop(); setExporting(true); setNotice(null)
    try { const result = await window.magicKey.exportVideo({ project: project(), quality }); if (result.path) setNotice({ kind: 'success', message: `Export saved: ${result.path}` }) }
    catch (error) { fail('Export failed.', error) } finally { setExporting(false) }
  }
  const setLaneFlag = (kind: Track, lane: number, flag: 'muted' | 'hidden') => commitEdit({ ...edit, lanes: { ...edit.lanes, [kind]: edit.lanes[kind].map((l, i) => i === lane ? { ...l, [flag]: !l[flag] } : l) } }, false)
  const moveLane = (clip: Segment, lane: number) => {
    const kind = edit.video.some((c) => c.id === clip.id) ? 'video' : 'audio', moved = { ...clip, lane }
    if (edit[kind].some((c) => c.id !== clip.id && c.lane === lane && overlaps(c, moved))) { fail('That position is occupied on the destination track.'); return }
    commitEdit({ ...edit, [kind]: edit[kind].map((c) => c.id === clip.id ? moved : c) }); setActiveLane({ kind, lane })
  }
  const applyEffects = async (clip: Segment, fx: ClipEffects, allSelected = false) => {
    if (operation.current) return
    operation.current = true; setBusy('Preparing clip effects…'); stop()
    try {
      const kind = edit.video.some((c) => c.id === clip.id) ? 'video' : 'audio'
      const ids = new Set(allSelected ? selectedClips.filter((c) => edit[kind].some((item) => item.id === c.id)).map((c) => c.id) : [clip.id])
      ids.add(clip.id)
      const sources = new Set(edit[kind].filter((c) => ids.has(c.id)).map((c) => c.mediaId))
      await Promise.all(media.filter((m) => sources.has(m.id) && m.metadata.audio).map((m) => window.magicKey?.audioPreview(m.path, fx)))
      commitEdit({ ...edit, [kind]: edit[kind].map((c) => ids.has(c.id) ? { ...c, effects: { ...fx } } : c) })
    } catch (error) { fail('Could not prepare effects.', error) }
    finally { operation.current = false; setBusy('') }
  }
  const analyzeSync = async (referenceId: string, targetId: string) => {
    if (!window.magicKey || syncBusy) return
    const reference = edit.video.find((c) => c.id === referenceId), target = edit.audio.find((c) => c.id === targetId)
    if (!reference || !target) return
    if (reference.linkId || target.linkId) { fail('Unlink these clips before analyzing a new audio alignment.'); return }
    const refSource = media.find((m) => m.id === reference.mediaId)!, targetSource = media.find((m) => m.id === target.mediaId)!
    setSyncBusy(true); setCandidate(null); stop()
    try {
      const result = await window.magicKey.syncAudio({ referencePath: refSource.path, referenceStart: reference.start, referenceEnd: reference.end, targetPath: targetSource.path, targetStart: target.start, targetEnd: target.end })
      if (live.current.fp !== fp) throw new Error('The project changed during analysis. Analyze the pair again.')
      setCandidate({ ...result, referenceId, targetId, at: reference.at + result.referenceStart - reference.start - (result.targetMatch - target.start), fingerprint: fp })
    } catch (error) { fail('Audio sync could not find an alignment.', error) } finally { setSyncBusy(false) }
  }
  const applySync = (link: boolean, preview: boolean) => {
    if (!candidate || candidate.fingerprint !== fp) return
    const reference = edit.video.find((c) => c.id === candidate.referenceId), target = edit.audio.find((c) => c.id === candidate.targetId)
    if (!reference || !target) return
    try {
      let next = edit, moved = { ...target, at: candidate.at }
      if (edit.audio.some((c) => c.id !== target.id && c.lane === target.lane && overlaps(c, moved))) {
        const lane = edit.lanes.audio.length; if (lane >= 16) throw new Error('Alignment needs a free audio track.')
        next = { ...edit, lanes: { ...edit.lanes, audio: [...edit.lanes.audio, { name: `Audio ${lane + 1}`, muted: false, hidden: false }] } }; moved = { ...moved, lane }
      }
      next = { ...next, audio: next.audio.map((c) => c.id === moved.id ? moved : c) }
      if (preview) {
        ensureMixer(); next = { ...next, lanes: { video: next.lanes.video.map((l, i) => ({ ...l, muted: i !== reference.lane, hidden: i !== reference.lane })), audio: next.lanes.audio.map((l, i) => ({ ...l, muted: i !== moved.lane })) } }
        const time = reference.at + candidate.referenceStart - reference.start
        setAudition(next); seek(time); playbackEnd.current = Math.min(time + 8, endAt(reference), endAt(moved)); setPlaying(true)
      } else { if (link) next = linkClips(next, [reference.id, target.id]); commitEdit(next); setSelection([reference.id, target.id]); setFocusId(target.id); setCandidate(null) }
    } catch (error) { fail('Could not apply alignment.', error) }
  }

  const timelinePoint = (x: number) => { const bounds = tracksRef.current!.getBoundingClientRect(); return Math.max(0, Math.min(timelineDuration, (x - bounds.left) / bounds.width * timelineDuration)) }
  const beginScrub = (event: React.PointerEvent) => { if (event.button !== 0 || (event.target as Element).closest('[data-segment-id]')) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); scrubbing.current = true; seek(Math.round(timelinePoint(event.clientX) * fps) / fps) }
  const moveScrub = (event: React.PointerEvent) => { if (scrubbing.current) seek(Math.round(timelinePoint(event.clientX) * fps) / fps) }
  const beginClip = (event: React.PointerEvent, kind: Track, clip: Segment) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setFocusId(clip.id); setActiveLane({ kind, lane: clip.lane })
    const group = linkedSelection(edit, [clip.id]), additive = event.ctrlKey || event.metaKey || event.shiftKey
    const ids = additive ? selection.includes(clip.id) ? selection.filter((id) => !group.includes(id)) : linkedSelection(edit, [...selection, ...group]) : selection.includes(clip.id) ? linkedSelection(edit, selection) : group
    setSelection(ids); if (!ids.includes(clip.id)) return
    setDragDuration(timelineDuration); clipDrag.current = { x: event.clientX, scroll: viewportRef.current?.scrollLeft || 0, base: state, ids, moved: false, scale: timelineDuration / tracksRef.current!.clientWidth, collapse: !additive && ids.length > group.length ? group : undefined }
  }
  const moveClip = (event: React.PointerEvent) => {
    event.stopPropagation(); const drag = clipDrag.current; if (!drag) return
    const pixels = event.clientX - drag.x + (viewportRef.current?.scrollLeft || 0) - drag.scroll
    if (!drag.moved && Math.abs(pixels) < 3) return
    const result = moveClips(drag.base.edit, drag.ids, Math.round(pixels * drag.scale * fps) / fps, event.altKey ? 0 : 8 * drag.scale, positionRef.current)
    if (!drag.moved && !result.delta) return
    if (!drag.moved) { stop(); record(drag.base); drag.moved = true }
    setState({ media: drag.base.media, edit: result.edit })
  }
  const endClip = () => { const drag = clipDrag.current; if (drag && !drag.moved && drag.collapse) setSelection(drag.collapse); clipDrag.current = null; setDragDuration(null) }
  const beginTrim = (event: React.PointerEvent, kind: Track, clip: Segment, edge: 'start' | 'end') => { event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelection(linkedSelection(edit, [clip.id])); setFocusId(clip.id); setActiveLane({ kind, lane: clip.lane }); trimDrag.current = { kind, id: clip.id, edge, moved: false } }
  const moveTrim = (event: React.PointerEvent) => {
    event.stopPropagation(); const drag = trimDrag.current; if (!drag) return
    const clip = edit[drag.kind].find((c) => c.id === drag.id), item = clip && media.find((m) => m.id === clip.mediaId); if (!clip || !item) return
    const value = clip.start + Math.round((timelinePoint(event.clientX) - clip.at) * fps) / fps, next = trimClip(edit, clip.id, drag.edge, value, item.metadata.duration, frame)
    if (JSON.stringify(next) === JSON.stringify(edit)) return
    if (!drag.moved) { stop(); record(); drag.moved = true }; setState({ media, edit: next })
  }
  const trimInput = (edge: 'start' | 'end') => {
    if (!selected || !selectedMedia) return
    const value = Number(trimDraft[edge]); if (!Number.isFinite(value)) return
    commitEdit(trimClip(edit, selected.id, edge, Math.round(value * fps) / fps, selectedMedia.metadata.duration, frame))
  }
  const beginFade = (event: React.PointerEvent, clip: Segment, edge: 'fadeIn' | 'fadeOut') => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    setSelection(linkedSelection(edit, [clip.id])); setFocusId(clip.id); setActiveLane({ kind: 'video', lane: clip.lane })
    const max = Math.min(10, (clip.end - clip.start) / 2)
    fadeDrag.current = { id: clip.id, edge, x: event.clientX, scroll: viewportRef.current?.scrollLeft || 0, scale: timelineDuration / tracksRef.current!.clientWidth, initial: Math.min(max, effects(clip.effects)[edge]), max, base: state, moved: false }
    setActiveFade(`${clip.id}:${edge}`)
  }
  const moveFade = (event: React.PointerEvent) => {
    event.stopPropagation(); const drag = fadeDrag.current; if (!drag) return
    const pixels = event.clientX - drag.x + (viewportRef.current?.scrollLeft || 0) - drag.scroll
    if (!drag.moved && Math.abs(pixels) < 3) return
    const value = Math.max(0, Math.min(drag.max, drag.initial + Math.round(pixels * drag.scale * (drag.edge === 'fadeIn' ? 1 : -1) * fps) / fps))
    const clip = drag.base.edit.video.find((c) => c.id === drag.id); if (!clip || (!drag.moved && value === effects(clip.effects)[drag.edge])) return
    if (!drag.moved) { stop(); record(drag.base); drag.moved = true }
    setState({ ...drag.base, edit: { ...drag.base.edit, video: drag.base.edit.video.map((c) => c.id === drag.id ? { ...c, effects: { ...c.effects, [drag.edge]: value } } : c) } })
  }
  const endFade = (event: React.PointerEvent) => { event.stopPropagation(); fadeDrag.current = null; setActiveFade(null) }
  const keyFade = (event: React.KeyboardEvent, clip: Segment, edge: 'fadeIn' | 'fadeOut') => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    if (fadeDrag.current) return
    const max = Math.min(10, (clip.end - clip.start) / 2), current = Math.min(max, effects(clip.effects)[edge])
    const delta = (event.key === 'ArrowRight' ? 1 : -1) * (edge === 'fadeIn' ? 1 : -1) * frame * (event.shiftKey ? 10 : 1)
    const value = event.key === 'Home' ? 0 : event.key === 'End' ? max : Math.max(0, Math.min(max, current + delta))
    commitEdit({ ...edit, video: edit.video.map((c) => c.id === clip.id ? { ...c, effects: { ...c.effects, [edge]: value } } : c) })
  }
  const changeZoom = (value: number) => { setZoom(value); requestAnimationFrame(() => { const node = viewportRef.current; if (node && tracksRef.current) node.scrollLeft = position / timelineDuration * tracksRef.current.clientWidth - node.clientWidth / 2 }) }
  useEffect(() => {
    const node = viewportRef.current, surface = node?.closest('.timeline-scroll'); if (!node || !surface) return
    const wheel = (event: Event) => { const e = event as WheelEvent; if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); if (clipDrag.current || trimDrag.current || fadeDrag.current) return; const bounds = node.getBoundingClientRect(), anchor = Math.max(0, Math.min(node.clientWidth, e.clientX - bounds.left)), fraction = (node.scrollLeft + anchor) / (node.clientWidth * zoom / 100), delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node.clientHeight : 1), next = Math.max(100, Math.min(4000, zoom * Math.exp(-delta * .002))); setZoom(next); requestAnimationFrame(() => { node.scrollLeft = fraction * node.clientWidth * next / 100 - anchor }) }
    surface.addEventListener('wheel', wheel, { passive: false }); return () => surface.removeEventListener('wheel', wheel)
  }, [zoom])
  const beginResize = (event: React.PointerEvent, kind: 'sidebar' | 'timeline') => { event.currentTarget.setPointerCapture(event.pointerId); resizing.current = { kind, initial: kind === 'sidebar' ? sidebarWidth : timelineHeight, x: event.clientX, y: event.clientY } }
  const moveResize = (event: React.PointerEvent) => { const r = resizing.current; if (!r) return; if (r.kind === 'sidebar') setSidebarWidth(Math.max(220, Math.min(560, r.initial + event.clientX - r.x))); else setTimelineHeight(Math.max(220, Math.min(window.innerHeight - 300, r.initial + r.y - event.clientY))) }
  const selectLane = (kind: Track, lane: number) => { setActiveLane({ kind, lane }); const c = activeClip(edit[kind].filter((c) => c.lane === lane), position) || edit[kind].find((c) => c.lane === lane); setSelection(c ? linkedSelection(edit, [c.id]) : []); setFocusId(c?.id || '') }
  const renderClip = (kind: Track, clip: Segment) => {
    const item = media.find((m) => m.id === clip.mediaId); if (!item) return null
    const e = effects(clip.effects), d = clip.end - clip.start
    return <div key={clip.id} data-segment-id={clip.id} className={`clip ${kind}-clip draggable ${selection.includes(clip.id) ? 'selected' : ''} ${clip.linkId ? 'linked-clip' : ''}`} style={{ left: `${clip.at / timelineDuration * 100}%`, width: `${d / timelineDuration * 100}%` }} onPointerDown={(event) => beginClip(event, kind, clip)} onPointerMove={moveClip} onPointerUp={endClip} onPointerCancel={endClip}>
      <span className="trim-handle left" title="Trim source start" onPointerDown={(event) => beginTrim(event, kind, clip, 'start')} onPointerMove={moveTrim} onPointerUp={() => { trimDrag.current = null }} onPointerCancel={() => { trimDrag.current = null }} />
      <Waveform data={item.waveform} start={clip.start} end={clip.end} left={clip.at / timelineDuration * viewport.width * zoom / 100} width={d / timelineDuration * viewport.width * zoom / 100} viewport={viewport.width} scroll={viewport.scroll} />
      <div className="clip-title"><strong>{clip.linkId && <Link2 size={11} />}{item.name}</strong><small>{clock(clip.start)} → {clock(clip.end)} {Object.entries(e).some(([key, val]) => val !== defaultEffects[key as keyof ClipEffects]) && ' · FX'}</small></div>
      {(kind === 'video' ? e.fadeIn : e.audioFadeIn) > 0 && <i className="fade-marker in" style={{ width: `${Math.min(.5, (kind === 'video' ? e.fadeIn : e.audioFadeIn) / d) * 100}%` }} />}
      {(kind === 'video' ? e.fadeOut : e.audioFadeOut) > 0 && <i className="fade-marker out" style={{ width: `${Math.min(.5, (kind === 'video' ? e.fadeOut : e.audioFadeOut) / d) * 100}%` }} />}
      {kind === 'video' && (['fadeIn', 'fadeOut'] as const).map((edge) => {
        const value = Math.min(e[edge], 10, d / 2), label = edge === 'fadeIn' ? 'Fade from black' : 'Fade to black', active = activeFade === `${clip.id}:${edge}`
        return <button key={edge} type="button" role="slider" aria-label={`${label}: ${item.name}`} aria-valuemin={0} aria-valuemax={Math.min(10, d / 2)} aria-valuenow={value} aria-valuetext={`${value.toFixed(2)} seconds`} title={`${label}: ${value.toFixed(2)}s — drag inward to add, outward to remove; Home resets`} className={`video-fade-handle ${edge === 'fadeIn' ? 'in' : 'out'} ${active ? 'adjusting' : ''}`} style={{ [edge === 'fadeIn' ? 'left' : 'right']: `clamp(10px, calc(${value / d * 100}% - 16px), calc(100% - 26px))` }} onPointerDown={(event) => beginFade(event, clip, edge)} onPointerMove={moveFade} onPointerUp={endFade} onPointerCancel={endFade} onLostPointerCapture={endFade} onKeyDown={(event) => keyFade(event, clip, edge)}>
          <span className="fade-triangle" />{active && <span className="fade-duration">{value.toFixed(2)}s</span>}
        </button>
      })}
      <span className="trim-handle right" title="Trim source end" onPointerDown={(event) => beginTrim(event, kind, clip, 'end')} onPointerMove={moveTrim} onPointerUp={() => { trimDrag.current = null }} onPointerCancel={() => { trimDrag.current = null }} />
    </div>
  }
  return <main className="app-shell studio-shell" style={{ '--timeline-height': `${timelineHeight}px`, '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDropping(true) } }} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDragLeave={(event) => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDropping(false) } }} onDrop={drop}>
    {busy && <div className="project-busy">{busy}</div>}{dropping && <div className="drop-overlay"><FolderOpen size={42} /><strong>Drop local media to import</strong><span>Or drop a .mkproj file to open it</span></div>}
    <header className="topbar"><div className="brand"><span className="brand-mark"><KeyRound size={18} /></span>Magic Keyframe</div><div className="project-title">{dirty ? '● ' : ''}{title}<small>{autosaved ? `Autosaved ${new Date(autosaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Autosave on'}</small></div><div className="top-actions"><button className="icon-button" title="New project" onClick={() => commands.current('new')}><FilePlus2 size={17} /></button><button className="icon-button" title="Open project" onClick={() => commands.current('open')}><FolderOpen size={17} /></button><button className="icon-button" title="Save project (Ctrl+S)" onClick={() => commands.current('save')}><Save size={17} /></button><button className="icon-button" title="Undo" disabled={!undoStack.length} onClick={undo}><Undo2 size={17} /></button><button className="icon-button" title="Redo" disabled={!redoStack.length} onClick={redo}><Redo2 size={17} /></button><select className="export-quality" aria-label="Export resolution" value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}><option value="2160p">4K</option><option value="1080p">1080p</option></select><button className="button primary" disabled={!edit.video.length || exporting} onClick={() => void exportVideo()}><Download size={16} />{exporting ? 'Exporting…' : 'Export'}</button></div></header>
    <section className="workspace"><aside className="media-panel panel"><div className="sidebar-tabs"><button className={tab === 'media' ? 'active' : ''} onClick={() => setTab('media')}><FolderOpen size={15} />Media</button><button className={tab === 'effects' ? 'active' : ''} onClick={() => setTab('effects')}><WandSparkles size={15} />Effects</button></div>
      {tab === 'media' ? <><div className="panel-heading"><h2>Project media</h2><button className="icon-button" title="Import media" onClick={() => void importMedia()}><Plus size={18} /></button></div><button className="import-card" onClick={() => void importMedia()}><span><FolderOpen size={21} /></span><strong>Import video / audio</strong><small>Click or drop local files</small></button><div className="media-list">{!media.length && <div className="empty-media">Import camera recordings, recorder audio, or music.</div>}{media.map((item) => <div className="media-item" key={item.id}><span className={`media-icon ${item.kind}`}>{item.thumbnail ? <img src={item.thumbnail} alt="Media thumbnail" /> : item.kind === 'video' ? <Video size={17} /> : <AudioLines size={17} />}</span><span className="media-copy"><strong title={item.name}>{item.name}</strong><small>{clock(item.metadata.duration)} · {item.kind === 'video' ? proxies[item.id] ? 'Preview ready' : proxyErrors[item.id] ? 'Proxy failed' : 'Preparing proxy' : 'Audio'}</small>{proxyErrors[item.id] && <button className="text-button" onClick={() => { proxyAttempted.current.delete(`${item.id}:${item.path}`); setState((s) => ({ ...s, media: [...s.media] })) }}>Retry proxy</button>}</span><button className="icon-button media-add" title="Add another copy at playhead" onClick={() => addMedia(item)}><Plus size={15} /></button></div>)}</div><p className="muted-copy">Imports append on track 1. The + button places a copy at the playhead; occupied positions get a new track.</p></> : <EffectsPanel selectedCount={selectedClips.filter((c) => edit[selectedKind].some((item) => item.id === c.id)).length} clip={selected} kind={selectedKind} media={media} edit={edit} onDraft={draftChanged} onApply={applyEffects} onLane={moveLane} onAnalyze={(a, b) => void analyzeSync(a, b)} onApplySync={applySync} onClearSync={() => { setCandidate(null); setAudition(null) }} syncBusy={syncBusy} candidate={candidate} auditioning={!!audition} />}
    </aside><section className="viewer-panel panel"><div className="viewer-heading"><span>{audition ? 'SYNC AUDITION · proposed alignment, not yet applied' : 'Preview'}</span><span>Effects preview · 720p proxies</span></div>
      {notice && <div className={`status-banner ${notice.kind}`}><span>{notice.message}</span><button onClick={() => setNotice(null)}>×</button></div>}
      {recoveries.length > 0 && <div className="recovery-banner"><strong>Recovery available: {recoveries[0].title}</strong><span>{new Date(recoveries[0].created).toLocaleString()}</span><button onClick={() => commands.current('recover', recoveries[0].file)}>Restore</button><button onClick={async () => { const r = recoveries[0]; try { await window.magicKey?.discardRecovery(r.projectPath, r.session); setRecoveries((s) => s.slice(1)) } catch (error) { fail('Could not dismiss recovery.', error) } }}>Dismiss</button></div>}
      <Preview edit={viewEdit} media={media} proxies={proxies} playing={playing} position={position} mixer={mixer} draft={tab === 'effects' ? draft : undefined} />
      <div className="transport"><span className="timecode">{clock(position, true)}<em> / {clock(projectDuration, true)}</em></span><div className="transport-controls"><button title="Previous cut" onClick={() => seek(ordered(edit[activeLane.kind].filter((c) => c.lane === activeLane.lane)).reverse().find((c) => c.at < position - frame)?.at || 0)}><SkipBack size={18} /></button><button className="play-button" onClick={togglePlay}>{playing ? <Pause size={18} /> : <Play size={18} />}</button><button title="Next cut" onClick={() => seek(ordered(edit[activeLane.kind].filter((c) => c.lane === activeLane.lane)).find((c) => c.at > position + frame)?.at ?? projectDuration)}><SkipForward size={18} /></button></div><Meter mixer={mixer} /></div>
    </section><div className="sidebar-resizer" onPointerDown={(e) => beginResize(e, 'sidebar')} onPointerMove={moveResize} onPointerUp={() => { resizing.current = null }} onPointerCancel={() => { resizing.current = null }} /></section>
    <section className="timeline-panel panel"><div className="timeline-resizer" onPointerDown={(e) => beginResize(e, 'timeline')} onPointerMove={moveResize} onPointerUp={() => { resizing.current = null }} onPointerCancel={() => { resizing.current = null }} /><div className="timeline-tools"><div className="tool-group"><span className="tool active">{selection.length} selected</span><button className="tool" disabled={!canSplit} onClick={split}><Scissors size={15} />Split</button><button className="tool" disabled={!selection.length} onClick={remove}><Trash2 size={15} />Remove</button><button className="tool" disabled={!canLink} onClick={() => changeLinks(false)}><Link2 size={15} />Link</button><button className="tool" disabled={!canUnlink} onClick={() => changeLinks(true)}><Unlink2 size={15} />Unlink</button></div><div className="edit-controls"><div className="align-controls"><button title="Step playhead back one frame (Left arrow)" disabled={!projectDuration} onClick={() => stepFrame(-1)}>−1 frame</button><button title="Step playhead forward one frame (Right arrow)" disabled={!projectDuration} onClick={() => stepFrame(1)}>+1 frame</button></div><div className="trim-inputs">{(['start', 'end'] as const).map((edge) => <label key={edge}>{edge === 'start' ? 'IN' : 'OUT'}<input type="number" step={frame} aria-label={`${edge} source seconds`} disabled={!selected} value={trimDraft[edge]} onChange={(e) => setTrimDraft((s) => ({ ...s, [edge]: e.target.value }))} onBlur={() => trimInput(edge)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} /></label>)}</div></div><div className="zoom"><button title="Add video track" onClick={() => addLane('video')}>+ V</button><button title="Add audio track" onClick={() => addLane('audio')}>+ A</button><button onClick={() => changeZoom(100)}>Fit</button><input aria-label="Timeline zoom" type="range" min="100" max="4000" step="50" value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} /></div></div>
      <div className="timeline-scroll"><div className="timeline-content"><div className="track-labels"><div className="ruler-spacer" />{rows.map(({ kind, lane, index }) => <div key={`${kind}:${index}`} className={`track-header ${activeLane.kind === kind && activeLane.lane === index ? 'selected-track' : ''}`} onClick={() => selectLane(kind, index)}><button className="track-select">{kind === 'video' ? <Video size={13} /> : <AudioLines size={13} />}<span>{lane.name.toUpperCase()}</span></button><div className="lane-controls"><div className="track-switches"><button title={`${lane.muted ? 'Unmute' : 'Mute'} ${lane.name}`} aria-pressed={lane.muted} className={lane.muted ? 'switch-off' : ''} onClick={(e) => { e.stopPropagation(); setLaneFlag(kind, index, 'muted') }}>{lane.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>{kind === 'video' && <button title={`${lane.hidden ? 'Show' : 'Hide'} ${lane.name}`} aria-pressed={lane.hidden} onClick={(e) => { e.stopPropagation(); setLaneFlag(kind, index, 'hidden') }}>{lane.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>}</div><Meter mixer={mixer} lane={`${kind}:${index}`} /></div></div>)}</div>
      <div className="track-viewport" ref={viewportRef} style={{ height: `${30 + rows.length * 86 + 14}px` }}><div className="tracks" ref={tracksRef} style={{ width: `${zoom}%`, minHeight: `${30 + rows.length * 86}px` }}><div className="ruler" onPointerDown={beginScrub} onPointerMove={moveScrub} onPointerUp={() => { scrubbing.current = false }} onPointerCancel={() => { scrubbing.current = false }}>{Array.from({ length: Math.min(200, Math.max(7, Math.round(7 * zoom / 100))) }, (_, i) => i).map((_, i, list) => <span key={i} style={{ left: `${i / (list.length - 1) * 100}%` }}>{clock(i / (list.length - 1) * timelineDuration)}<i /></span>)}</div><div className="playhead" style={{ left: `${Math.min(100, position / timelineDuration * 100)}%` }}><i /></div>{rows.map(({ kind, lane, index }) => <div key={`${kind}:${index}`} className={`track ${kind}-track ${lane.hidden ? 'track-disabled' : ''}`} onPointerDown={(event) => { setActiveLane({ kind, lane: index }); beginScrub(event) }} onPointerMove={moveScrub} onPointerUp={() => { scrubbing.current = false }} onPointerCancel={() => { scrubbing.current = false }}>{edit[kind].filter((c) => c.lane === index).map((c) => renderClip(kind, c))}</div>)}</div></div></div></div>
      <div className="timeline-help">Ctrl/Shift+click: multi-select · Drag: move · Arrows: step · Alt+arrows: move clips · Top triangles: fades · Link preserves sync · Effects: color, audio and sync · Wheel: zoom</div>
    </section>
  </main>
}
