import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const isDev = !app.isPackaged

function createWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 930,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#090a0d',
    titleBarStyle: 'hiddenInset',
    title: 'Magic Key',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) window.loadURL('http://localhost:5173')
  else window.loadFile(path.join(__dirname, '../dist/index.html'))
}

ipcMain.handle('media:choose', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Add media to Magic Key',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video and audio', extensions: ['mp4', 'mov', 'mxf', 'wav', 'mp3', 'm4a', 'aac'] },
    ],
  })
  if (result.canceled) return []
  return result.filePaths.map((filePath) => ({
    path: filePath,
    url: pathToFileURL(filePath).toString(),
    name: path.basename(filePath),
  }))
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
