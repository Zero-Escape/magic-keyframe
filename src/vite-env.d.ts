/// <reference types="vite/client" />

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
  waveform: number[]
}

interface Window {
  magicKey?: {
    chooseMedia: () => Promise<ImportedMedia[]>
    getPathForFile: (file: File) => string
    importMedia: (paths: string[]) => Promise<ImportedMedia[]>
    generateProxy: (filePath: string) => Promise<{ path: string; url: string }>
    exportVideo: (request: { videoPath: string; audioPath?: string; segments: { start: number; end: number }[]; audioOffset: number; audioSegments: { start: number; end: number }[]; videoMuted: boolean; audioMuted: boolean; videoHidden: boolean }) => Promise<{ canceled: boolean; path?: string }>
  }
}
