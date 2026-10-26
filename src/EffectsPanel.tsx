import { useEffect, useRef, useState } from 'react'
import { effects, defaultEffects, effectLimits, type ClipEffects } from '../electron/effects'
import { transitionEdges, type Segment, type TimelineEdit, type Track } from '../electron/timeline'
import type { MediaItem } from './editor-types'
import type { SyncResult } from '../electron/sync-types'
export type SyncCandidate = SyncResult & { referenceId: string; targetId: string; at: number; fingerprint: string }
type Props = {
  selectedCount: number; clip?: Segment; kind: Track; media: MediaItem[]; edit: TimelineEdit
  onDraft: (value?: { id: string; value: ClipEffects }) => void
  onApply: (clip: Segment, fx: ClipEffects, allSelected: boolean) => Promise<void>
  onLane: (clip: Segment, lane: number) => void
  onAnalyze: (reference: string, target: string) => void
  onApplySync: (link: boolean, preview: boolean) => void
  onClearSync: () => void; syncBusy: boolean; candidate: SyncCandidate | null; auditioning: boolean
}
const rowSpecs: { key: keyof ClipEffects; label: string; step: number; unit?: string }[] = [
  { key: 'exposure', label: 'Exposure', step: .05, unit: ' EV' }, { key: 'contrast', label: 'Contrast', step: .02 },
  { key: 'saturation', label: 'Saturation', step: .02 }, { key: 'temperature', label: 'Warmth', step: .02 },
  { key: 'fadeIn', label: 'Fade from black', step: .1, unit: ' s' }, { key: 'fadeOut', label: 'Fade to black', step: .1, unit: ' s' },
  { key: 'gainDb', label: 'Gain', step: .5, unit: ' dB' }, { key: 'audioFadeIn', label: 'Audio fade in', step: .1, unit: ' s' }, { key: 'audioFadeOut', label: 'Audio fade out', step: .1, unit: ' s' },
  { key: 'compression', label: 'Compress loud peaks', step: .05 }, { key: 'leveling', label: 'Level quiet / loud passages', step: .05 },
  { key: 'vocal', label: 'Voice clarity', step: .1 }, { key: 'noise', label: 'Noise reduction', step: 1, unit: ' dB' }, { key: 'hiss', label: 'Mic hiss reduction', step: 1, unit: ' dB' },
]
export function EffectsPanel(props: Props) {
  const { clip, kind, media, edit } = props, item = clip && media.find((m) => m.id === clip.mediaId)
  const blend = clip ? transitionEdges(edit[kind], clip) : { incoming: 0, outgoing: 0 }
  const [draft, setDraft] = useState<ClipEffects>(effects(clip?.effects)), [bypass, setBypass] = useState(false), [applying, setApplying] = useState(false)
  const [allSelected, setAllSelected] = useState(false), [measuring, setMeasuring] = useState(false), [reading, setReading] = useState<{ key: string; text: string }>()
  const measurement = useRef(0)
  useEffect(() => { measurement.current++; setMeasuring(false) }, [clip?.id, clip?.start, clip?.end, item?.path, draft])
  const [reference, setReference] = useState(''), [target, setTarget] = useState(''), [link, setLink] = useState(true)
  useEffect(() => { setDraft(effects(clip?.effects)); setBypass(false); setAllSelected(false) }, [clip?.id, clip?.effects])
  useEffect(() => { props.onDraft(clip ? { id: clip.id, value: bypass ? { ...draft, exposure: 0, contrast: 1, saturation: 1, temperature: 0, fadeIn: 0, fadeOut: 0 } : draft } : undefined) }, [clip?.id, draft, bypass])
  useEffect(() => () => props.onDraft(undefined), [])
  const cameras = edit.video.filter((c) => media.find((m) => m.id === c.mediaId)?.metadata.audio)
  useEffect(() => {
    if (!cameras.some((c) => c.id === reference)) setReference(cameras[0]?.id || '')
    if (!edit.audio.some((c) => c.id === target)) setTarget(edit.audio[0]?.id || '')
  }, [edit.video, edit.audio])
  useEffect(() => { props.onClearSync() }, [reference, target])
  const label = (c: Segment) => `${media.find((m) => m.id === c.mediaId)?.name || 'Missing media'} · ${c.at.toFixed(1)}s`
  const update = (key: keyof ClipEffects, value: number) => setDraft((e) => ({ ...e, [key]: value }))
  const row = (key: keyof ClipEffects) => {
    const spec = rowSpecs.find((r) => r.key === key)!, [min, max] = effectLimits[key]
    return <label className="effect-row" key={key}><span>{spec.label}<output>{draft[key].toFixed(spec.step >= 1 ? 0 : spec.step >= .1 ? 1 : 2)}{spec.unit}</output></span><input type="range" aria-label={spec.label} min={min} max={max} step={spec.step} value={draft[key]} onChange={(e) => update(key, Number(e.target.value))} /></label>
  }
  return <div className="effects-panel">
    <h2>Effects</h2><p className="muted-copy">Effects apply to the active clip, not linked partners. Trims and splits follow links.</p>{(blend.incoming > 0 || blend.outgoing > 0) && <p className="muted-copy">Automatic overlap transition: {blend.incoming > 0 ? `in ${blend.incoming.toFixed(2)}s ` : ''}{blend.outgoing > 0 ? `out ${blend.outgoing.toFixed(2)}s` : ''}. This replaces black/audio fades at the shared edges. Drag clips apart to remove it.</p>}
    {clip && item ? <>
      <div className="inspector-source"><strong>{item.name}</strong><small>{kind === 'video' ? 'Video' : 'Audio'} · source {clip.start.toFixed(2)}–{clip.end.toFixed(2)}s</small></div>
      <label className="effect-row">Timeline track<select value={clip.lane} onChange={(event) => props.onLane(clip, Number(event.target.value))}>{edit.lanes[kind].map((lane, index) => <option key={index} value={index}>{lane.name}</option>)}</select></label>
      {kind === 'video' && <><h3>Color</h3>{(['exposure', 'contrast', 'saturation', 'temperature'] as const).map(row)}<label className="check-row"><input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} /> Bypass color / video fades for comparison</label>
        <h3>Video transitions</h3><div className="effect-presets"><button onClick={() => setDraft((e) => ({ ...e, fadeIn: .5, fadeOut: 0 }))}>Fade in</button><button onClick={() => setDraft((e) => ({ ...e, fadeIn: 0, fadeOut: .5 }))}>Fade out</button><button onClick={() => setDraft((e) => ({ ...e, fadeIn: .5, fadeOut: .5 }))}>Both</button></div>{row('fadeIn')}{row('fadeOut')}<p className="muted-copy">Fades use black, not an overlapping dissolve.</p></>}
      {item.metadata.audio && <><h3>Audio</h3>{(['gainDb', 'audioFadeIn', 'audioFadeOut', 'compression', 'leveling', 'vocal', 'noise', 'hiss'] as const).map(row)}<div className="effect-presets"><button onClick={() => setDraft((e) => ({ ...e, hiss: 6 }))}>Gentle de-hiss</button><button onClick={() => setDraft((e) => ({ ...e, hiss: 12 }))}>Stronger de-hiss</button><button onClick={() => setDraft((e) => ({ ...e, hiss: 0 }))}>De-hiss off</button><button onClick={() => setDraft((e) => ({ ...e, compression: .4, leveling: .6 }))}>Level speech / music</button><button onClick={() => setDraft((e) => ({ ...e, vocal: .6, noise: 8 }))}>Gentle speech cleanup</button><button onClick={() => setDraft((e) => ({ ...e, audioFadeIn: .25, audioFadeOut: .5 }))}>Soften edges</button></div><p className="muted-copy">Mic hiss targets steady broadband noise, not ringing feedback. Start at 6 dB and Apply; stronger cleanup can dull speech/music. Noise reduction and de-hiss share one spectral pass, using the larger amount rather than adding them. Leveling lifts quiet passages; compression restrains loud peaks. Start gently: strong leveling can raise room noise. It cannot separate speech from music playing at the same time. Gain/fades audition live; Apply prepares other audio effects once and caches them for preview/export.</p>
        <button className="button secondary" disabled={measuring || applying || !window.magicKey} onClick={async () => {
          const token = ++measurement.current; setMeasuring(true); setReading(undefined)
          try {
            const result = await window.magicKey!.measureAudio(item.path, clip.start, clip.end, draft)
            if (measurement.current !== token) return
            const next = { ...draft, gainDb: Math.round(result.gainDb * 10) / 10 }
            setDraft(next)
            setReading({ key: JSON.stringify([clip.id, item.path, clip.start, clip.end, next]), text: `${result.integrated.toFixed(1)} LUFS · ${result.peak.toFixed(1)} dBTP · range ${result.range.toFixed(1)} LU. Gain matched toward −16 LUFS${result.peakLimited ? ' (limited by peak headroom; add compression if needed)' : ''}. Click Apply to save.` })
          } catch (error) { if (measurement.current === token) setReading({ key: JSON.stringify([clip.id, item.path, clip.start, clip.end, draft]), text: String(error) }) }
          finally { if (measurement.current === token) setMeasuring(false) }

        }}>{measuring ? 'Measuring selected section…' : 'Measure & match loudness'}</button>
        {reading?.key === JSON.stringify([clip.id, item.path, clip.start, clip.end, draft]) && <p className="loudness-reading" role="status">{reading.text}</p>}
        <p className="muted-copy">For vows versus music, split them into sections and match each separately. Measurement excludes fades and track mixing; listen to the final mix.</p></>}
      <label className="check-row"><input type="checkbox" checked={allSelected} disabled={props.selectedCount < 2} onChange={(e) => setAllSelected(e.target.checked)} />Apply all settings to selected {kind} clips ({props.selectedCount})</label><p className="muted-copy">Draft controls are not saved until you click Apply to clip.</p><div className="effect-actions"><button className="button secondary" disabled={applying} onClick={() => setDraft({ ...defaultEffects })}>Reset draft</button><button className="button primary" disabled={applying || JSON.stringify(effects(clip.effects)) === JSON.stringify(draft)} onClick={async () => { setApplying(true); try { await props.onApply(clip, draft, allSelected) } finally { setApplying(false) } }}>{applying ? 'Preparing…' : 'Apply to clip'}</button></div>
    </> : <p className="empty-inspector">Select a timeline clip to adjust its color, sound or transitions.</p>}
    <section className="sync-panel"><h3>Automatic waveform sync</h3><label>Camera reference<select aria-label="Sync camera" value={reference} onChange={(e) => setReference(e.target.value)}>{cameras.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}</select></label><label>Recorder clip<select aria-label="Sync recorder" value={target} onChange={(e) => setTarget(e.target.value)}>{edit.audio.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}</select></label><button className="button secondary" disabled={!reference || !target || props.syncBusy} onClick={() => props.onAnalyze(reference, target)}>{props.syncBusy ? 'Comparing audio…' : 'Find alignment'}</button>
      {props.candidate && <div className={`sync-result ${props.candidate.confidence}`}><strong>{props.candidate.confidence.toUpperCase()} confidence</strong><span>Match score {props.candidate.score.toFixed(2)} · proposed start {props.candidate.at.toFixed(3)}s</span>{props.candidate.confidence === 'low' && <p>The match is ambiguous. Audition carefully or align manually.</p>}<label className="check-row"><input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} /> Link the pair after applying</label><button className="button secondary" disabled={props.auditioning} onClick={() => props.onApplySync(false, true)}>{props.auditioning ? 'Auditioning…' : 'Audition both sources (8s)'}</button><button className="button primary" onClick={() => props.onApplySync(link, false)}>Apply alignment</button></div>}
      <p className="muted-copy">Uses original camera/recorder audio. Shared speech or distinct sounds are needed. Unlink existing pairs before re-aligning. No drift correction.</p>
    </section>
  </div>
}
