import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { buildAppMenu } from './menu'

// ── Window management ─────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',       // macOS: traffic lights inset
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,           // required for security
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    // Dev: Vite dev server
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools()
  } else {
    // Prod: built files
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const win = createWindow()
  Menu.setApplicationMenu(buildAppMenu(win))

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked with no windows open
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow()
      Menu.setApplicationMenu(buildAppMenu(newWin))
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC handlers — File I/O ───────────────────────────────────────────────────
// These run in the privileged main process. The renderer never touches the FS
// directly — it always asks main via ipcRenderer.invoke().

ipcMain.handle('file:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [
      { name: 'Notation Files', extensions: ['notation'] },
      { name: 'MusicXML', extensions: ['xml', 'mxl', 'musicxml'] }
    ],
    properties: ['openFile']
  })
  if (canceled || filePaths.length === 0) return null

  const raw = await readFile(filePaths[0], 'utf-8')
  return { path: filePaths[0], content: raw }
})

ipcMain.handle('file:save', async (_event, { path, content }: { path: string; content: string }) => {
  await writeFile(path, content, 'utf-8')
  return { success: true }
})

ipcMain.handle('file:saveAs', async (_event, { content }: { content: string }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    filters: [{ name: 'Notation Files', extensions: ['notation'] }],
    defaultPath: 'Untitled.notation'
  })
  if (canceled || !filePath) return null

  await writeFile(filePath, content, 'utf-8')
  return { path: filePath, success: true }
})

ipcMain.handle('midi:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'MIDI Files', extensions: ['mid', 'midi'] }],
    properties: ['openFile']
  })
  if (canceled || filePaths.length === 0) return null

  const buf = await readFile(filePaths[0])
  return { bytes: new Uint8Array(buf), path: filePaths[0] }
})

ipcMain.handle('midi:export', async (_event, { bytes }: { bytes: Uint8Array }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    filters: [{ name: 'MIDI Files', extensions: ['mid'] }],
    defaultPath: 'Untitled.mid'
  })
  if (canceled || !filePath) return { success: false }

  await writeFile(filePath, Buffer.from(bytes))
  return { success: true }
})

ipcMain.handle('pdf:export', async (_event, { bytes }: { bytes: Uint8Array }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    defaultPath: 'Untitled.pdf'
  })
  if (canceled || !filePath) return { success: false }

  await writeFile(filePath, Buffer.from(bytes))
  return { success: true }
})

ipcMain.handle('musicxml:export', async (_event, { xml }: { xml: string }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    filters: [{ name: 'MusicXML Files', extensions: ['xml'] }],
    defaultPath: 'Untitled.xml'
  })
  if (canceled || !filePath) return { success: false }

  await writeFile(filePath, xml, 'utf8')
  return { success: true }
})
