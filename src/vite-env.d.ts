/// <reference types="vite/client" />

interface WaveformData { bucketSeconds: number; channels: { min: number[]; max: number[] }[] }
interface ProjectData {
  format: 'magic-keyframe-project'; version: 1
  media: { id: string; kind: 'video' | 'audio'; path: string }[]
  edit: { video: { id: string; start: number; end: number }[]; audio: { id: string; start: number; end: number }[]; audioOffset: number }
  tracks: { videoMuted: boolean; audioMuted: boolean; videoHidden: boolean }
  view: { position: number; zoom: number; timelineHeight: number; sidebarWidth: number }
}
interface ImportedMedia {
  path: string
  url: string
  name: string
  metadata: {
    duration: number
    bitRate: number
    container?: string
    video?: { codec?: string; profile?: string; width?: number; height?: number; fps?: number; pixelFormat?: string }
    audio?: { codec?: string; sampleRate?: number; channels?: number }
  }
  waveform?: WaveformData
  thumbnail?: string
}

interface Window {
  magicKey?: {
    saveProject: (project: ProjectData, filePath?: string) => Promise<string | null>
    openProject: (filePath?: string) => Promise<{ path: string; project: ProjectData; relinked: boolean; media: (ImportedMedia & { id: string; kind: 'video' | 'audio' })[] } | null>
    confirmProject: () => Promise<'save' | 'discard' | 'cancel'>
    setProjectDirty: (dirty: boolean) => void
    closeProjectWindow: () => void
    onCommand: (callback: (command: string, filePath?: string) => void) => () => void
    chooseMedia: () => Promise<ImportedMedia[]>
    getPathForFile: (file: File) => string
    importMedia: (paths: string[]) => Promise<ImportedMedia[]>
    generateProxy: (filePath: string) => Promise<{ path: string; url: string }>
    exportVideo: (request: { videoPath: string; audioPath?: string; segments: { start: number; end: number }[]; audioOffset: number; audioSegments: { start: number; end: number }[]; videoMuted: boolean; audioMuted: boolean; videoHidden: boolean }) => Promise<{ canceled: boolean; path?: string }>
  }
}
