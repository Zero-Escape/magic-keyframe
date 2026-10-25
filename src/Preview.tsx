import { useEffect, useRef, useState } from 'react'
import { activeClip, type Segment, type TimelineEdit } from '../electron/timeline'
import { effects, fadeFactor, type ClipEffects } from '../electron/effects'
import type { MediaItem } from './editor-types'

export class AudioMixer {
  context = new AudioContext()
  private master = this.context.createAnalyser()
  private limiter = this.context.createDynamicsCompressor()
  private lanes = new Map<string, AnalyserNode>()
  private sources = new WeakMap<HTMLMediaElement, { source: MediaElementAudioSourceNode; gain: GainNode }>()
  constructor() {
    this.master.fftSize = 1024; this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = .003; this.limiter.release.value = .1
    this.master.connect(this.limiter); this.limiter.connect(this.context.destination)
  }
  register(element: HTMLMediaElement, lane: string) {
    let node = this.sources.get(element)
    if (!node) { node = { source: this.context.createMediaElementSource(element), gain: this.context.createGain() }; this.sources.set(element, node) }
    let bus = this.lanes.get(lane)
    if (!bus) { bus = this.context.createAnalyser(); bus.fftSize = 512; bus.connect(this.master); this.lanes.set(lane, bus) }
    node.source.disconnect(); node.gain.disconnect(); node.source.connect(node.gain); node.gain.connect(bus)
    return { gain: node.gain, release: () => { node!.source.disconnect(); node!.gain.disconnect() } }
  }
  peak(lane?: string) {
    const node = lane ? this.lanes.get(lane) : this.master
    if (!node || this.context.state !== 'running') return 0
    const samples = new Float32Array(node.fftSize); node.getFloatTimeDomainData(samples)
    let peak = 0; for (const sample of samples) peak = Math.max(peak, Math.abs(sample)); return peak
  }
}
export function Meter({ mixer, lane }: { mixer: AudioMixer | null; lane?: string }) {
  const [peak, setPeak] = useState(0)
  useEffect(() => { const timer = window.setInterval(() => setPeak(mixer?.peak(lane) || 0), 100); return () => clearInterval(timer) }, [mixer, lane])
  const db = peak > .00001 ? 20 * Math.log10(peak) : -100
  return <div className={`level-meter ${db > -.5 ? 'clipping' : ''}`} title={db > -.5 ? 'High level: reduce clip gain' : 'Live audio level before master limiter'}><span><i style={{ width: `${Math.max(0, Math.min(100, (db + 60) / 60 * 100))}%` }} /></span><small>{db < -60 ? '−∞' : db.toFixed(0)} dB</small></div>
}
function AudioLane({ clip, item, muted, playing, position, mixer, override }: { clip?: Segment; item?: MediaItem; muted: boolean; playing: boolean; position: number; mixer: AudioMixer | null; override?: Partial<ClipEffects> }) {
  const ref = useRef<HTMLAudioElement>(null), [processed, setProcessed] = useState<{ key: string; url: string }>(), [error, setError] = useState('')
  const fx = effects(override || clip?.effects), processingKey = `${item?.path || ''}:${fx.vocal}:${fx.noise}`
  const gainRef = useRef<GainNode | null>(null), previous = useRef<{ src?: string; wanted: number; playing: boolean; offset: number } | undefined>(undefined), pending = useRef(false)
  const active = useRef({ clip, muted, playing, position, fx }); active.current = { clip, muted, playing, position, fx }
  useEffect(() => {
    if (!item?.metadata.audio || !window.magicKey) return
    let canceled = false; setError('')
    if (!fx.vocal && !fx.noise && item.audioUrl) { setProcessed({ key: processingKey, url: item.audioUrl }); return }
    void window.magicKey.audioPreview(item.path, { vocal: fx.vocal, noise: fx.noise }).then((result) => { if (!canceled) setProcessed({ key: processingKey, url: result.url }) }).catch((err) => { if (!canceled) setError(String(err)) })
    return () => { canceled = true }
  }, [processingKey, item?.audioUrl])
  const ready = processed?.key === processingKey
  const src = ready ? processed.url : undefined
  const lane = `${item?.kind || 'audio'}:${clip?.lane ?? 0}`
  useEffect(() => {
    const node = ref.current
    if (!node || !mixer) return
    const connection = mixer.register(node, lane); gainRef.current = connection.gain
    return () => { connection.release(); gainRef.current = null; node.pause() }
  }, [mixer, lane])
  useEffect(() => {
    const player = ref.current; if (!player) return
    const sync = () => {
      const state = active.current, c = state.clip
      if (!c || !src) { player.pause(); return }
      const wanted = c.start + state.position - c.at
      if (Number.isFinite(player.duration) && wanted >= player.duration) { player.pause(); return }
      const prior = previous.current, offset = c.start - c.at
      const changed = !prior || prior.src !== src || Math.abs(prior.offset - offset) > 1e-6
      const scrubbed = !state.playing && (!prior || prior.wanted !== wanted)
      const canSync = player.readyState >= 1 && !player.seeking
      if (canSync && (changed || scrubbed || state.playing && Math.abs(player.currentTime - wanted) > .25) && Math.abs(player.currentTime - wanted) > .01) player.currentTime = Math.max(0, wanted)
      if (canSync) previous.current = { src, wanted, playing: state.playing, offset }
      const d = c.end - c.start, fade = fadeFactor(state.position - c.at, d, Math.min(state.fx.audioFadeIn, d / 2), Math.min(state.fx.audioFadeOut, d / 2))
      const gain = state.muted ? 0 : 10 ** (state.fx.gainDb / 20) * fade
      if (gainRef.current && mixer) { player.muted = false; player.volume = 1; gainRef.current.gain.setTargetAtTime(gain, mixer.context.currentTime, .005) }
      else { player.muted = state.muted; player.volume = Math.min(1, gain) }
      if (state.playing && player.paused && !pending.current) { pending.current = true; void player.play().catch(() => {}).finally(() => { pending.current = false }) }
      else if (!state.playing) player.pause()
    }
    sync(); player.addEventListener('loadedmetadata', sync); player.addEventListener('canplay', sync); player.addEventListener('seeked', sync)
    return () => { player.removeEventListener('loadedmetadata', sync); player.removeEventListener('canplay', sync); player.removeEventListener('seeked', sync) }
  }, [clip?.id, position, muted, playing, src, fx.gainDb, fx.audioFadeIn, fx.audioFadeOut, mixer])
  return <><audio ref={ref} src={src} preload="auto" />{clip && item?.metadata.audio && (!ready || error) && <span className="audio-preparing">{error ? `Audio preview failed: ${error}` : 'Preparing audio preview…'}</span>}</>
}
function VideoSurface({ clip, src, playing, position, override, fps }: { clip: Segment; src: string; playing: boolean; position: number; override?: Partial<ClipEffects>; fps: number }) {
  const [fallback, setFallback] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), pending = useRef(false), previous = useRef<{ src: string; wanted: number; offset: number } | undefined>(undefined)
  const state = useRef({ clip, playing, position, override, src, fps }); state.current = { clip, playing, position, override, src, fps }
  useEffect(() => {
    const video = videoRef.current; if (!video) return
    const sync = () => {
      const s = state.current, wanted = Math.max(0, s.clip.start + s.position - s.clip.at), offset = s.clip.start - s.clip.at, prior = previous.current
      const changed = !prior || prior.src !== s.src || Math.abs(prior.offset - offset) > 1e-6
      const scrubbed = !s.playing && (!prior || prior.wanted !== wanted)
      // A contiguous split changes clip identity, not source time. Pausing alone
      // must not seek either: both used to flush the decoder and flash black.
      const canSync = video.readyState >= 1 && !video.seeking
      if (canSync && (changed || scrubbed || s.playing && Math.abs(video.currentTime - wanted) > .3) && Math.abs(video.currentTime - wanted) > .5 / s.fps) video.currentTime = wanted
      if (canSync) previous.current = { src: s.src, wanted, offset }
      if (s.playing && video.paused && !pending.current) { pending.current = true; void video.play().catch(() => {}).finally(() => { pending.current = false }) }
      else if (!s.playing) video.pause()
    }
    sync(); video.addEventListener('loadedmetadata', sync); video.addEventListener('canplay', sync); video.addEventListener('seeked', sync)
    return () => { video.removeEventListener('loadedmetadata', sync); video.removeEventListener('canplay', sync); video.removeEventListener('seeked', sync) }
  }, [clip.id, clip.start, clip.at, position, playing, src, fps])
  useEffect(() => {
    const canvas = canvasRef.current!, video = videoRef.current!, gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: false })
    if (!gl) { setFallback(true); return }
    const compile = (kind: number, source: string) => { const shader = gl.createShader(kind)!; gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Preview shader failed'); return shader }
    let vert: WebGLShader, frag: WebGLShader
    try { vert = compile(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.0)*0.5,1.0-(p.y+1.0)*0.5);gl_Position=vec4(p,0.0,1.0);}')
    frag = compile(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 uv;uniform sampler2D image;uniform vec3 gain;uniform float contrast;uniform float saturation;uniform float fade;void main(){vec3 c=clamp((texture2D(image,uv).rgb*gain-vec3(0.5))*contrast+vec3(0.5),0.0,1.0);float l=dot(c,vec3(0.2126,0.7152,0.0722));gl_FragColor=vec4(clamp(mix(vec3(l),c,saturation),0.0,1.0)*fade,1.0);}')
    } catch { setFallback(true); return }
    const program = gl.createProgram()!; gl.attachShader(program, vert); gl.attachShader(program, frag); gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { setFallback(true); return }; gl.useProgram(program)
    const buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const location = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
    const texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(gl.getUniformLocation(program, 'image'), 0)
    let frame = 0, hasTexture = false, aspect = 16 / 9
    const draw = () => {
      if (gl.isContextLost()) { setFallback(true); return }
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT)
      // Keep drawing the last decoded texture through short seeks/buffering.
      // Only intentional timeline gaps (handled by Preview) should go black.
      if (video.readyState >= 2 && video.videoWidth && !video.seeking) {
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video); hasTexture = true; aspect = video.videoWidth / video.videoHeight } catch { setFallback(true); return }
      }
      if (hasTexture) {
        const s = state.current, e = effects(s.override || s.clip.effects), gain = 2 ** e.exposure, d = s.clip.end - s.clip.start
        const cw = canvas.width, ch = canvas.height, w = Math.min(cw, ch * aspect), h = w / aspect
        gl.viewport((cw - w) / 2, (ch - h) / 2, w, h)
        gl.uniform3f(gl.getUniformLocation(program, 'gain'), gain * (1 + e.temperature * .12), gain, gain * (1 - e.temperature * .12))
        gl.uniform1f(gl.getUniformLocation(program, 'contrast'), e.contrast); gl.uniform1f(gl.getUniformLocation(program, 'saturation'), e.saturation)
        gl.uniform1f(gl.getUniformLocation(program, 'fade'), fadeFactor(s.position - s.clip.at, d, Math.min(e.fadeIn, d / 2), Math.min(e.fadeOut, d / 2)))
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); video.pause(); gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vert); gl.deleteShader(frag) }
  }, [])
  const displayed = effects(override || clip.effects), d = clip.end - clip.start
  return <><video ref={videoRef} className={fallback ? 'fallback-decoder' : 'preview-decoder'} style={fallback ? { filter: `brightness(${2 ** displayed.exposure}) contrast(${displayed.contrast}) saturate(${displayed.saturation})`, opacity: fadeFactor(position - clip.at, d, Math.min(displayed.fadeIn, d / 2), Math.min(displayed.fadeOut, d / 2)) } : undefined} src={src} muted playsInline preload="auto" />{fallback && <span className="audio-preparing">Compatibility preview: warmth is export-only without WebGL.</span>}<canvas className={`graded-preview ${fallback ? 'hidden' : ''}`} ref={canvasRef} width={1280} height={720} /></>
}
export function Preview({ edit, media, proxies, playing, position, mixer, draft }: { edit: TimelineEdit; media: MediaItem[]; proxies: Record<string, string>; playing: boolean; position: number; mixer: AudioMixer | null; draft?: { id: string; value: ClipEffects } }) {
  const visible = edit.video.filter((c) => !edit.lanes.video[c.lane].hidden && position >= c.at && position < c.at + c.end - c.start).sort((a, b) => b.lane - a.lane)[0]
  const source = visible && media.find((m) => m.id === visible.mediaId)
  return <div className="viewer studio-viewer">
    {visible && source ? proxies[source.id] ? <VideoSurface fps={source.metadata.video?.fps || 29.97} clip={visible} src={proxies[source.id]} playing={playing} position={position} override={draft?.id === visible.id ? draft.value : undefined} /> : <div className="viewer-empty">Preparing video proxy…</div> : <div className="viewer-empty">{media.length ? 'No visible video at this position' : 'Import your footage to begin'}</div>}
    {(['video', 'audio'] as const).flatMap((kind) => edit.lanes[kind].map((lane, index) => {
      const clip = activeClip(edit[kind].filter((c) => c.lane === index), position), item = clip && media.find((m) => m.id === clip.mediaId)
      return <AudioLane key={`${kind}:${index}`} clip={clip} item={item} muted={lane.muted} playing={playing} position={position} mixer={mixer} override={draft && clip && draft.id === clip.id ? { ...draft.value, vocal: effects(clip.effects).vocal, noise: effects(clip.effects).noise } : undefined} />
    }))}
  </div>
}
