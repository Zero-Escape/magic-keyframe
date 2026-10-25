/// <reference types="vite/client" />
interface WaveformData { bucketSeconds: number; channels: { min: number[]; max: number[] }[] }
interface ProjectData {
  format: 'magic-keyframe-project'; version: 3
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
interface Window {
  magicKey?: {
    autosave: (project: ProjectData, filePath: string | undefined, session: string) => Promise<number>
    recoveries: () => Promise<RecoveryInfo[]>
    recoverProject: (filePath: string) => Promise<LoadedProject | null>
    discardRecovery: (filePath: string | undefined, session: string) => Promise<void>
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
    generateProxy: (filePath: string) => Promise<{ path: string; url: string }>
    exportVideo: (request: { project: ProjectData; quality: '2160p' | '1080p' }) => Promise<{ canceled: boolean; path?: string }>
  }
}
