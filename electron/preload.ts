import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('magicKey', {
  chooseMedia: () => ipcRenderer.invoke('media:choose'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  importMedia: (paths: string[]) => ipcRenderer.invoke('media:import', paths),
  generateProxy: (filePath: string) => ipcRenderer.invoke('media:proxy', filePath),
  exportVideo: (request: unknown) => ipcRenderer.invoke('media:export', request),
})
