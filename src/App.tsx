import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AudioLines, ChevronDown, Clapperboard, Download, FolderOpen, KeyRound,
  Layers3, Pause, Play, Plus, Redo2, Scissors, Settings2, SkipBack,
  SkipForward, Sparkles, Undo2, Video, Volume2, WandSparkles, ZoomIn, ZoomOut,
} from 'lucide-react'

type MediaItem = ImportedMedia & { id: string; kind: 'video' | 'audio' }

const formatTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

function Waveform({ peaks }: { peaks?: number[] }) {
  const bars = useMemo(() => peaks?.length
    ? peaks.filter((_, i) => i % Math.max(1, Math.floor(peaks.length / 180)) === 0)
    : [], [peaks])
  return <div className={`waveform ${bars.length ? '' : 'loading-waveform'}`}>{bars.map((height, i) => <i key={i} style={{ height: `${Math.max(3, height * 100)}%` }} />)}</div>
}

export default function App() {
  const [media, setMedia] = useState<MediaItem[]>([])
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(62)
  const [position, setPosition] = useState(8.4)
  const [audioOffset, setAudioOffset] = useState(0)
  const [dragStart, setDragStart] = useState<{ x: number; offset: number } | null>(null)
  const [proxyUrl, setProxyUrl] = useState<string>()
  const [proxying, setProxying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [trimDrag, setTrimDrag] = useState<'start' | 'end' | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  const video = media.find((item) => item.kind === 'video')
  const audio = media.find((item) => item.kind === 'audio')
  const timelineDuration = video?.metadata.duration || 31.5
  const fps = video?.metadata.video?.fps || 29.97

  useEffect(() => {
    if (video) {
      setTrimStart(0)
      setTrimEnd(video.metadata.duration)
    }
  }, [video?.id])

  const importMedia = async () => {
    const picked = await window.magicKey?.chooseMedia()
    if (!picked) return
    setMedia((current) => [...current, ...picked.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      kind: /\.(wav|mp3|m4a|aac)$/i.test(item.name) ? 'audio' as const : 'video' as const,
    }))])
    const addedVideo = picked.find((item) => item.metadata.video)
    if (addedVideo && window.magicKey) {
      setProxying(true)
      try { setProxyUrl((await window.magicKey.generateProxy(addedVideo.path)).url) }
      finally { setProxying(false) }
    }
  }

  const syncExternalAudio = (videoTime: number, play: boolean) => {
    const player = audioRef.current
    if (!player || !audio) return
    const wanted = videoTime - audioOffset
    if (wanted < 0 || wanted >= audio.metadata.duration) { player.pause(); return }
    if (Math.abs(player.currentTime - wanted) > .08) player.currentTime = wanted
    if (play) void player.play()
  }

  const togglePlayback = () => {
    const player = videoRef.current
    if (player) {
      if (playing) { player.pause(); audioRef.current?.pause() }
      else {
        if (player.currentTime < trimStart || player.currentTime >= trimEnd) player.currentTime = trimStart
        syncExternalAudio(player.currentTime, true)
        void player.play()
      }
    }
    setPlaying(!playing)
  }

  const handleTimeUpdate = (currentTime: number) => {
    if (currentTime >= trimEnd && videoRef.current) {
      videoRef.current.pause(); audioRef.current?.pause(); setPlaying(false)
      videoRef.current.currentTime = trimStart; setPosition(trimStart); return
    }
    setPosition(currentTime)
    syncExternalAudio(currentTime, playing)
  }

  const handleExport = async () => {
    if (!video || !window.magicKey) return
    setExporting(true)
    try { await window.magicKey.exportVideo({ videoPath: video.path, audioPath: audio?.path, trimStart, trimEnd, audioOffset }) }
    finally { setExporting(false) }
  }

  const beginAudioDrag = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragStart({ x: event.clientX, offset: audioOffset })
  }

  const moveAudio = (event: React.PointerEvent) => {
    if (!dragStart || !tracksRef.current) return
    setAudioOffset(dragStart.offset + (event.clientX - dragStart.x) * timelineDuration / tracksRef.current.clientWidth)
  }

  const nudgeAudio = (frames: number) => setAudioOffset((offset) => offset + frames / fps)

  const beginTrim = (event: React.PointerEvent, edge: 'start' | 'end') => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setTrimDrag(edge)
  }

  const moveTrim = (event: React.PointerEvent) => {
    if (!trimDrag || !tracksRef.current) return
    const bounds = tracksRef.current.getBoundingClientRect()
    const time = Math.max(0, Math.min(timelineDuration, (event.clientX - bounds.left) / bounds.width * timelineDuration))
    if (trimDrag === 'start') setTrimStart(Math.min(time, trimEnd - 1 / fps))
    else setTrimEnd(Math.max(time, trimStart + 1 / fps))
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><KeyRound size={18} /></span><span>Magic Key</span></div>
        <div className="project-title"><span className="status-dot" /> Untitled Wedding <ChevronDown size={14} /></div>
        <div className="top-actions">
          <button className="icon-button"><Undo2 size={17} /></button>
          <button className="icon-button muted"><Redo2 size={17} /></button>
          <button className="button secondary"><Settings2 size={16} /> Project</button>
          <button className="button primary" onClick={handleExport} disabled={!video || exporting}><Download size={16} /> {exporting ? 'Exporting…' : 'Export'}</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="media-panel panel">
          <div className="panel-heading"><div><span className="eyebrow">PROJECT</span><h2>Media</h2></div><button className="icon-button" onClick={importMedia}><Plus size={18} /></button></div>
          <button className="import-card" onClick={importMedia}><span><FolderOpen size={21} /></span><strong>Import footage</strong><small>Video or external audio</small></button>
          <div className="media-list">
            {media.length === 0 && <div className="empty-media"><Clapperboard size={25} /><p>Your footage will live here.</p><small>Start with the camera video and matching recorder audio.</small></div>}
            {media.map((item) => <div className="media-item" key={item.id}>
              <span className={`media-icon ${item.kind}`} >{item.kind === 'video' ? <Video size={16} /> : <AudioLines size={16} />}</span>
              <span className="media-copy"><strong>{item.name}</strong><small>{item.kind === 'video' ? `${item.metadata.video?.width}×${item.metadata.video?.height} · ${item.metadata.video?.fps?.toFixed(2)} fps` : `${(item.metadata.audio?.sampleRate || 0) / 1000} kHz · ${item.metadata.audio?.channels === 1 ? 'Mono' : 'Stereo'}`}</small></span>
            </div>)}
          </div>
          <div className="assistant-card"><WandSparkles size={18} /><div><strong>Audio alignment</strong><small>{video && audio ? 'Waveforms ready for manual syncing' : 'Add video and audio to begin'}</small></div><span className="beta">PRECISE</span></div>
        </aside>

        <section className="viewer-panel panel">
          <div className="viewer-heading"><span>Preview</span><span className="quality-pill">{proxying ? 'BUILDING PROXY…' : proxyUrl ? 'PROXY · 1080P' : 'ORIGINAL'} <ChevronDown size={12} /></span></div>
          <div className="viewer">
            {video ? <><video ref={videoRef} src={proxyUrl || video.url} muted={Boolean(audio)} onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget.currentTime)} onSeeked={(event) => syncExternalAudio(event.currentTarget.currentTime, playing)} onEnded={() => setPlaying(false)} /><audio ref={audioRef} src={audio?.url} /></> :
              <div className="viewer-empty"><span className="glow"><Sparkles size={30} /></span><h1>Your story starts here</h1><p>Import your Sony footage to begin.</p><button className="button primary" onClick={importMedia}><Plus size={16} /> Add media</button></div>}
          </div>
          <div className="transport">
            <span className="timecode">{formatTime(position)}<em> / {formatTime(timelineDuration)}</em></span>
            <div className="transport-controls"><button><SkipBack size={18} /></button><button className="play-button" onClick={togglePlayback}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button><SkipForward size={18} /></button></div>
            <div className="volume"><Volume2 size={17} /><span><i /></span></div>
          </div>
        </section>
      </section>

      <section className="timeline-panel panel">
        <div className="timeline-tools">
          <div className="tool-group"><button className="tool active"><Layers3 size={16} /> Select</button><button className="tool"><Scissors size={16} /> Split</button></div>
          <div className="edit-controls"><div className="align-controls"><button onClick={() => nudgeAudio(-1)} disabled={!audio}>−1 frame</button><span>{audioOffset >= 0 ? '+' : ''}{audioOffset.toFixed(3)}s</span><button onClick={() => nudgeAudio(1)} disabled={!audio}>+1 frame</button></div><div className="trim-inputs"><label>IN <input type="number" min="0" max={trimEnd} step={1 / fps} value={trimStart.toFixed(3)} onChange={(e) => setTrimStart(Math.min(Number(e.target.value), trimEnd - 1 / fps))} /></label><label>OUT <input type="number" min={trimStart} max={timelineDuration} step={1 / fps} value={trimEnd.toFixed(3)} onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 1 / fps))} /></label></div></div>
          <div className="zoom"><ZoomOut size={16} /><input type="range" min="30" max="100" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /><ZoomIn size={16} /></div>
        </div>
        <div className="timeline-scroll">
          <div className="track-labels"><div className="ruler-spacer" /><div><Video size={15} /><span>VIDEO 1</span></div><div><AudioLines size={15} /><span>AUDIO 1</span></div></div>
          <div className="tracks" ref={tracksRef}>
            <div className="ruler">{[0, .1667, .3333, .5, .6667, .8333, 1].map((part) => <span key={part} style={{ left: `${part * 100}%` }}>{formatTime(part * timelineDuration)}<i /></span>)}</div>
            <div className="playhead" style={{ left: `${Math.min(position / timelineDuration * 100, 100)}%` }}><i /></div>
            <div className="track video-track">{video && <div className="clip video-clip" style={{ left: `${trimStart / timelineDuration * 100}%`, width: `${(trimEnd - trimStart) / timelineDuration * 100}%` }}><span className="trim-handle left" onPointerDown={(e) => beginTrim(e, 'start')} onPointerMove={moveTrim} onPointerUp={() => setTrimDrag(null)} /><Waveform peaks={video.waveform} /><div className="clip-title"><strong>{video.name}</strong><small>{formatTime(trimStart)} → {formatTime(trimEnd)} · {video.metadata.video?.fps?.toFixed(2)} fps</small></div><span className="trim-handle right" onPointerDown={(e) => beginTrim(e, 'end')} onPointerMove={moveTrim} onPointerUp={() => setTrimDrag(null)} /></div>}</div>
            <div className="track audio-track">{audio && <div className="clip audio-clip draggable" style={{ width: '94%', transform: `translateX(${audioOffset / timelineDuration * (tracksRef.current?.clientWidth || 0)}px)` }} onPointerDown={beginAudioDrag} onPointerMove={moveAudio} onPointerUp={() => setDragStart(null)}><Waveform peaks={audio.waveform} /><span><strong>{audio.name}</strong><small>{(audio.metadata.audio?.sampleRate || 0) / 1000} kHz · {audio.metadata.audio?.channels === 1 ? 'MONO' : 'STEREO'}</small></span></div>}</div>
          </div>
        </div>
      </section>
    </main>
  )
}
