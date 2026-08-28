import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('magicKey', {
  chooseMedia: () => ipcRenderer.invoke('media:choose'),
})
