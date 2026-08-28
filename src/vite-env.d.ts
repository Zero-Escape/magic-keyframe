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
    generateProxy: (filePath: string) => Promise<{ path: string; url: string }>
    exportVideo: (request: { videoPath: string; audioPath?: string; trimStart: number; trimEnd: number; audioOffset: number }) => Promise<{ canceled: boolean; path?: string }>
  }
}
