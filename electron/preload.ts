import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('magicKey', {
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
  generateProxy: (filePath: string) => ipcRenderer.invoke('media:proxy', filePath),
  exportVideo: (request: unknown) => ipcRenderer.invoke('media:export', request),
})
