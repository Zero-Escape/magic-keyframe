import { timelineEnd } from '../electron/timeline'
import { useEffect, useRef, useState } from 'react'
import { defaultExportSettings, validateExportSettings, type ExportSettings, type ExportProgress } from '../electron/export-settings'
const durationLabel = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
export function ExportDialog({ project, sourceFps, onClose, onBusy, onStart, onComplete }: { project: ProjectData; sourceFps: number; onClose: () => void; onBusy: (busy: boolean) => void; onStart: () => Promise<void>; onComplete: (path: string) => void }) {
  const [settings, setSettings] = useState<ExportSettings>(() => { try { return validateExportSettings({ ...defaultExportSettings, ...JSON.parse(localStorage.getItem('mk-export-settings') || '{}'), rangeStart: 0, rangeEnd: 0 }) } catch { return { ...defaultExportSettings } } }), [running, setRunning] = useState(false), [started, setStarted] = useState(false)
  const [progress, setProgress] = useState<ExportProgress>(), [output, setOutput] = useState(''), [canceling, setCanceling] = useState(false)
  const cancelRequested = useRef(false), id = useRef(crypto.randomUUID()), [lastUpdate, setLastUpdate] = useState(0), [now, setNow] = useState(Date.now())
  useEffect(() => window.magicKey?.onExportProgress((event) => { if (event.id === id.current) { setProgress(event); setLastUpdate(Date.now()) } }), [])
  useEffect(() => { if (!running) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [running])
  const total = timelineEnd(project.edit), rangeEnd = settings.rangeEnd || total
  const validRange = Number.isFinite(settings.rangeStart) && Number.isFinite(settings.rangeEnd) && settings.rangeStart >= 0 && settings.rangeStart < rangeEnd && rangeEnd <= total
  const update = <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) => setSettings((s) => ({ ...s, [key]: value }))
  const begin = async () => {
    if (!window.magicKey || running) return
    id.current = crypto.randomUUID()
    try { localStorage.setItem('mk-export-settings', JSON.stringify({ ...settings, rangeStart: 0, rangeEnd: 0 })) } catch { /* Preferences are optional. */ }
    cancelRequested.current = false; setRunning(true); setStarted(true); onBusy(true); setOutput(''); setCanceling(false)
    setProgress({ id: id.current, phase: 'preparing', elapsed: 0, message: 'Pausing preview/proxies and preparing export…' }); setLastUpdate(Date.now())
    try {
      await onStart()
      if (cancelRequested.current) { setProgress({ id: id.current, phase: 'canceled', elapsed: 0, message: 'Export canceled before the encoder started.' }); return }
      const result = await window.magicKey.exportVideo({ id: id.current, project, settings })
      if (result.path) { setOutput(result.path); setProgress((s) => ({ id: id.current, ...s, phase: 'done', percent: 100, elapsed: s?.elapsed || 0, message: `Export saved: ${result.path}` })); onComplete(result.path) }
      else setProgress((s) => ({ id: id.current, phase: 'canceled', elapsed: s?.elapsed || 0, message: 'Export canceled. Source files and any previous output were not changed.' }))
    } catch (error) { setProgress((s) => ({ id: id.current, phase: 'error', elapsed: s?.elapsed || 0, message: String(error) })) }
    finally { setRunning(false); onBusy(false); setCanceling(false) }
  }
  return <div className="export-backdrop"><section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
    <header><h2 id="export-title">{started ? 'Export progress' : 'Export settings'}</h2><button className="icon-button" aria-label="Close export dialog" disabled={running} onClick={onClose}>×</button></header>
    {!started ? <>
      <p className="muted-copy">Delivery format: MP4 · 8-bit H.264 4:2:0 · Rec.709 · stereo AAC / 48 kHz. The next step chooses the destination.</p>
      <div className="export-settings-grid">
        <label>Resolution<select value={settings.resolution} onChange={(e) => setSettings((s) => ({ ...s, resolution: e.target.value as ExportSettings['resolution'], maxMbps: e.target.value === '2160p' ? 45 : 12 }))}><option value="1080p">1920 × 1080</option><option value="2160p">3840 × 2160 (4K)</option></select></label>
        <label>Frame rate<select value={settings.fps} onChange={(e) => update('fps', Number(e.target.value))}><option value={0}>Match source (~{sourceFps.toFixed(3)} fps)</option>{[24, 25, 29.97, 30, 50, 59.94, 60].map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}</select></label>
        <label>Quality<select value={settings.quality} onChange={(e) => update('quality', Number(e.target.value))}><option value={18}>High quality · larger file</option><option value={20}>Good quality · recommended</option><option value={23}>Smaller file</option><option value={26}>Draft</option></select></label>
        <label>Video bitrate ceiling (Mbps)<input type="number" min={2} max={100} step={1} value={settings.maxMbps} onChange={(e) => update('maxMbps', Number(e.target.value))} /></label>
        <label>Encoder<select value={settings.encoder} onChange={(e) => update('encoder', e.target.value as ExportSettings['encoder'])}><option value="auto">Auto: NVIDIA if available, otherwise CPU</option><option value="cpu">CPU · limited threads</option><option value="nvidia">NVIDIA GPU only</option></select></label>
        <label>Computer usage<select value={settings.resource} onChange={(e) => update('resource', e.target.value as ExportSettings['resource'])}><option value="low">Low impact · recommended</option><option value="balanced">Balanced · more CPU</option></select></label>
        <label>Audio bitrate<select value={settings.audioKbps} onChange={(e) => update('audioKbps', Number(e.target.value))}>{[128, 192, 256, 320].map((n) => <option key={n} value={n}>{n} kbps AAC</option>)}</select></label>
      </div>
      <h3>Export range</h3><div className="effect-presets"><button onClick={() => setSettings((s) => ({ ...s, rangeStart: 0, rangeEnd: 0 }))}>Entire timeline</button><button onClick={() => setSettings((s) => ({ ...s, rangeStart: Math.min(project.view.position, Math.max(0, total - 1)), rangeEnd: Math.min(total, Math.min(project.view.position, Math.max(0, total - 1)) + 30) }))}>30s sample from playhead</button></div>
      <div className="export-settings-grid"><label>Start (seconds)<input type="number" min={0} max={total} step={.1} value={settings.rangeStart} onChange={(e) => update('rangeStart', Number(e.target.value))} /></label><label>End (seconds; 0 = timeline end)<input type="number" min={0} max={total} step={.1} value={settings.rangeEnd} onChange={(e) => update('rangeEnd', Number(e.target.value))} /></label></div>
      <p className="muted-copy">{validRange ? `Export duration ~${durationLabel(rangeEnd - settings.rangeStart)}. Boundaries round outward to whole frames.` : 'Choose a range inside the timeline.'} Use a short sample before rendering the full wedding.</p>
      <p className="export-resource-note">{settings.resource === 'low' ? 'Low impact: one short piece at a time; up to 2 encoder threads, 1 decoder thread per source and 1 filter worker.' : 'Balanced: one short piece at a time; up to 4 encoder threads, 1 decoder thread per source and 1 filter worker.'} Both request below-normal process priority. Preview/proxy work pauses while exporting. Temporary pieces need extra space on the destination drive.</p>
      <footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" onClick={() => void begin()} disabled={!validRange || !Number.isFinite(settings.maxMbps) || settings.maxMbps < 2 || settings.maxMbps > 100}>Choose destination & export</button></footer>
    </> : <>
      <h3>{progress?.phase === 'rendering' ? 'Rendering video and audio' : progress?.phase === 'finalizing' ? 'Finalizing delivery file' : progress?.phase === 'done' ? 'Export complete' : progress?.phase === 'error' ? 'Export failed' : progress?.phase === 'canceled' ? 'Export canceled' : 'Preparing'}</h3>
      <p className="export-progress-message" aria-live="polite">{canceling ? 'Stopping encoder and cleaning temporary pieces…' : progress?.message}</p>
      <progress aria-label="Current export stage progress" max={100} value={progress?.percent} />
      <div className="export-statistics"><strong>{progress?.percent === undefined ? 'Working…' : `${progress.percent.toFixed(1)}% of this stage`}</strong><span>Elapsed {durationLabel(progress?.elapsed || 0)}</span>{progress?.etaSeconds !== undefined && <span>ETA ~{durationLabel(progress.etaSeconds)}</span>}{progress?.encoder && <span>{progress.encoder === 'nvidia' ? 'NVIDIA GPU' : 'Limited-thread CPU'}</span>}</div>
      {running && <p className="muted-copy">{lastUpdate && now - lastUpdate > 5000 ? 'Waiting for encoder status. You can cancel below.' : 'Encoder status updates once per second. Percentages refer to the named stage; finalization follows rendering.'}</p>}
      {progress?.warning && <p className="export-resource-note">{progress.warning}</p>}{output && <p className="export-output">{output}</p>}
      <footer>{running ? <button className="button secondary" disabled={canceling || progress?.phase === 'done'} onClick={async () => { cancelRequested.current = true; setCanceling(true); try { await window.magicKey?.cancelExport(id.current) } catch (error) { setCanceling(false); setProgress((s) => s && ({ ...s, warning: String(error) })) } }}>Cancel export</button> : <><button className="button secondary" onClick={onClose}>Close</button>{output && <button className="button primary" onClick={() => void window.magicKey?.showExport()}>Show in folder</button>}{!output && <button className="button primary" onClick={() => { setStarted(false); setProgress(undefined) }}>Back to settings</button>}</>}</footer>
    </>}
  </section></div>
}
