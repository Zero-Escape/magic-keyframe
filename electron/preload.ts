import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('magicKey', {
  chooseMedia: () => ipcRenderer.invoke('media:choose'),
  generateProxy: (filePath: string) => ipcRenderer.invoke('media:proxy', filePath),
  exportVideo: (request: unknown) => ipcRenderer.invoke('media:export', request),
})
