/// <reference types="vite/client" />

interface ImportedMedia {
  path: string
  url: string
  name: string
}

interface Window {
  magicKey?: {
    chooseMedia: () => Promise<ImportedMedia[]>
  }
}
