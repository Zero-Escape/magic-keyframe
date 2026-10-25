import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('magicKey', {
  autosave: (project: unknown, filePath: string | undefined, session: string) => ipcRenderer.invoke('project:autosave', project, filePath, session),
  recoveries: () => ipcRenderer.invoke('project:recoveries'),
  recoverProject: (filePath: string) => ipcRenderer.invoke('project:recover', filePath),
  discardRecovery: (filePath: string | undefined, session: string) => ipcRenderer.invoke('project:discard-recovery', filePath, session),
  measureAudio: (filePath: string, start: number, end: number, value: unknown) => ipcRenderer.invoke('media:measure-audio', filePath, start, end, value),
  audioPreview: (filePath: string, value: unknown) => ipcRenderer.invoke('media:audio-preview', filePath, value),
  syncAudio: (request: unknown) => ipcRenderer.invoke('media:sync', request),
  saveProject: (project: unknown, filePath?: string) => ipcRenderer.invoke('project:save', project, filePath),
  openProject: (filePath?: string) => ipcRenderer.invoke('project:open', filePath),
  confirmProject: () => ipcRenderer.invoke('project:confirm'),
  setProjectDirty: (dirty: boolean) => ipcRenderer.send('project:dirty', dirty),
  closeProjectWindow: () => ipcRenderer.send('project:close'),
  onCommand: (callback: (command: string, filePath?: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, command: string, filePath?: string) => callback(command, filePath)
    ipcRenderer.on('project:command', handler)
    ipcRenderer.send('project:ready')
    return () => ipcRenderer.removeListener('project:command', handler)
  },
  chooseMedia: () => ipcRenderer.invoke('media:choose'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  importMedia: (paths: string[]) => ipcRenderer.invoke('media:import', paths),
  cancelProxies: () => ipcRenderer.invoke('media:cancel-proxies'),
  onProxyProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('media:proxy-progress', handler)
    return () => ipcRenderer.removeListener('media:proxy-progress', handler)
  },
  generateProxy: (filePath: string) => ipcRenderer.invoke('media:proxy', filePath),
  cancelExport: (id: string) => ipcRenderer.invoke('media:cancel-export', id),
  onExportProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('media:export-progress', handler)
    return () => ipcRenderer.removeListener('media:export-progress', handler)
  },
  showExport: () => ipcRenderer.invoke('media:show-export'),
  exportVideo: (request: unknown) => ipcRenderer.invoke('media:export', request),
})
