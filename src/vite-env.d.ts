/// <reference types="vite/client" />
interface WaveformData { bucketSeconds: number; channels: { min: number[]; max: number[] }[] }
interface ProjectData {
  format: 'magic-keyframe-project'; version: 6
  media: { id: string; kind: 'video' | 'audio'; path: string }[]
  edit: import('../electron/timeline').TimelineEdit
  view: { position: number; zoom: number; timelineHeight: number; sidebarWidth: number }
}
interface ImportedMedia {
  path: string; url: string; name: string; audioUrl?: string; thumbnail?: string; waveform?: WaveformData
  metadata: { duration: number; bitRate: number; container?: string
    video?: { codec?: string; profile?: string; width?: number; height?: number; fps?: number; pixelFormat?: string }
    audio?: { codec?: string; sampleRate?: number; channels?: number }
  }
}
interface LoadedProject { path?: string; project: ProjectData; relinked: boolean; recovered?: boolean; session?: string; media: (ImportedMedia & { id: string; kind: 'video' | 'audio' })[] }
interface RecoveryInfo { file: string; projectPath?: string; created: number; title: string; session: string }
interface ProxyProgress { path: string; status: 'queued' | 'running' | 'ready' | 'error' | 'canceled'; percent: number; etaSeconds?: number }
interface Window {
  magicKey?: {
    autosave: (project: ProjectData, filePath: string | undefined, session: string) => Promise<number>
    recoveries: () => Promise<RecoveryInfo[]>
    recoverProject: (filePath: string) => Promise<LoadedProject | null>
    discardRecovery: (filePath: string | undefined, session: string) => Promise<void>
    measureAudio: (filePath: string, start: number, end: number, value: Partial<import('../electron/effects').ClipEffects>) => Promise<{ integrated: number; peak: number; range: number; gainDb: number; peakLimited: boolean }>
    audioPreview: (filePath: string, value: Partial<import('../electron/effects').ClipEffects>) => Promise<{ url: string }>
    syncAudio: (request: { referencePath: string; referenceStart: number; referenceEnd: number; targetPath: string; targetStart: number; targetEnd: number }) => Promise<import('../electron/sync-types').SyncResult>
    saveProject: (project: ProjectData, filePath?: string) => Promise<string | null>
    openProject: (filePath?: string) => Promise<LoadedProject | null>
    confirmProject: () => Promise<'save' | 'discard' | 'cancel'>
    setProjectDirty: (dirty: boolean) => void
    closeProjectWindow: () => void
    onCommand: (callback: (command: string, filePath?: string) => void) => () => void
    chooseMedia: () => Promise<ImportedMedia[]>
    getPathForFile: (file: File) => string
    importMedia: (paths: string[]) => Promise<ImportedMedia[]>
    cancelProxies: () => Promise<void>
    onProxyProgress: (callback: (progress: ProxyProgress) => void) => () => void
    generateProxy: (filePath: string) => Promise<{ path: string; url: string }>
    cancelExport: (id: string) => Promise<void>
    onExportProgress: (callback: (progress: import('../electron/export-settings').ExportProgress) => void) => () => void
    showExport: () => Promise<void>
    exportVideo: (request: { id: string; project: ProjectData; settings: import('../electron/export-settings').ExportSettings }) => Promise<{ canceled: boolean; path?: string }>
  }
}
