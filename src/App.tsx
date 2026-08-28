import { useMemo, useRef, useState } from 'react'
import {
  AudioLines, ChevronDown, Clapperboard, Download, FolderOpen, KeyRound,
  Layers3, Pause, Play, Plus, Redo2, Scissors, Settings2, SkipBack,
  SkipForward, Sparkles, Undo2, Video, Volume2, WandSparkles, ZoomIn, ZoomOut,
} from 'lucide-react'

type MediaItem = ImportedMedia & { id: string; kind: 'video' | 'audio'; duration?: number }

const formatTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

function Waveform({ compact = false }: { compact?: boolean }) {
  const bars = useMemo(() => Array.from({ length: compact ? 42 : 120 }, (_, i) =>
    18 + Math.abs(Math.sin(i * 1.91) * 46) + Math.abs(Math.cos(i * .37) * 28)), [compact])
  return <div className="waveform">{bars.map((height, i) => <i key={i} style={{ height: `${height}%` }} />)}</div>
}

export default function App() {
  const [media, setMedia] = useState<MediaItem[]>([])
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(62)
  const [position, setPosition] = useState(8.4)
  const videoRef = useRef<HTMLVideoElement>(null)
  const video = media.find((item) => item.kind === 'video')
  const audio = media.find((item) => item.kind === 'audio')

  const importMedia = async () => {
    const picked = await window.magicKey?.chooseMedia()
    if (!picked) return
    setMedia((current) => [...current, ...picked.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      kind: /\.(wav|mp3|m4a|aac)$/i.test(item.name) ? 'audio' as const : 'video' as const,
    }))])
  }

  const togglePlayback = () => {
    const player = videoRef.current
    if (player) playing ? player.pause() : player.play()
    setPlaying(!playing)
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
          <button className="button primary"><Download size={16} /> Export</button>
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
              <span className="media-copy"><strong>{item.name}</strong><small>{item.kind === 'video' ? '4K video' : 'External audio'}</small></span>
            </div>)}
          </div>
          <div className="assistant-card"><WandSparkles size={18} /><div><strong>Audio alignment</strong><small>{video && audio ? 'Waveforms ready for manual syncing' : 'Add video and audio to begin'}</small></div><span className="beta">PRECISE</span></div>
        </aside>

        <section className="viewer-panel panel">
          <div className="viewer-heading"><span>Preview</span><span className="quality-pill">PROXY · 1080P <ChevronDown size={12} /></span></div>
          <div className="viewer">
            {video ? <video ref={videoRef} src={video.url} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} onEnded={() => setPlaying(false)} /> :
              <div className="viewer-empty"><span className="glow"><Sparkles size={30} /></span><h1>Your story starts here</h1><p>Import your Sony footage to begin.</p><button className="button primary" onClick={importMedia}><Plus size={16} /> Add media</button></div>}
          </div>
          <div className="transport">
            <span className="timecode">00:{formatTime(position)}<em> / 00:00:31</em></span>
            <div className="transport-controls"><button><SkipBack size={18} /></button><button className="play-button" onClick={togglePlayback}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button><SkipForward size={18} /></button></div>
            <div className="volume"><Volume2 size={17} /><span><i /></span></div>
          </div>
        </section>
      </section>

      <section className="timeline-panel panel">
        <div className="timeline-tools">
          <div className="tool-group"><button className="tool active"><Layers3 size={16} /> Select</button><button className="tool"><Scissors size={16} /> Split</button></div>
          <button className="magic-sync" disabled={!video || !audio}><WandSparkles size={16} /> Align audio</button>
          <div className="zoom"><ZoomOut size={16} /><input type="range" min="30" max="100" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /><ZoomIn size={16} /></div>
        </div>
        <div className="timeline-scroll">
          <div className="track-labels"><div className="ruler-spacer" /><div><Video size={15} /><span>VIDEO 1</span></div><div><AudioLines size={15} /><span>AUDIO 1</span></div></div>
          <div className="tracks">
            <div className="ruler">{[0, 5, 10, 15, 20, 25, 30].map((n) => <span key={n} style={{ left: `${n / 30 * 100}%` }}>{`00:${String(n).padStart(2, '0')}`}<i /></span>)}</div>
            <div className="playhead" style={{ left: `${Math.min(position / 31.5 * 100, 100)}%` }}><i /></div>
            <div className="track video-track">{video && <div className="clip video-clip" style={{ width: `${zoom}%` }}><div className="clip-thumb"><Video size={15} /></div><div><strong>{video.name}</strong><small>XAVC S · 4K · 29.97</small></div></div>}</div>
            <div className="track audio-track">{audio && <div className="clip audio-clip" style={{ width: '94%' }}><Waveform /><span><strong>{audio.name}</strong><small>48 kHz · MONO</small></span></div>}</div>
          </div>
        </div>
      </section>
    </main>
  )
}
