import { contextBridge, ipcRenderer } from 'electron'

// This is the ONLY way the renderer talks to the main process.
// contextBridge.exposeInMainWorld whitelists exactly the API surface —
// the renderer cannot access ipcRenderer directly (contextIsolation: true).

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // ── File operations ────────────────────────────────────────────────────────
  openFile: () =>
    ipcRenderer.invoke('file:open') as Promise<{ path: string; content: string } | null>,

  saveFile: (path: string, content: string) =>
    ipcRenderer.invoke('file:save', { path, content }) as Promise<{ success: boolean }>,

  saveFileAs: (content: string) =>
    ipcRenderer.invoke('file:saveAs', { content }) as Promise<{ path: string; success: boolean } | null>,

  exportMidi: (bytes: Uint8Array) =>
    ipcRenderer.invoke('midi:export', { bytes }) as Promise<{ success: boolean }>,

  importMidi: () =>
    ipcRenderer.invoke('midi:import') as Promise<{ bytes: Uint8Array; path: string } | null>,

  exportPdf: (bytes: Uint8Array) =>
    ipcRenderer.invoke('pdf:export', { bytes }) as Promise<{ success: boolean }>,

  exportMusicXml: (xml: string) =>
    ipcRenderer.invoke('musicxml:export', { xml }) as Promise<{ success: boolean }>,

  importMusicXml: () =>
    ipcRenderer.invoke('musicxml:import') as Promise<{ xml: string; path: string } | null>,

  // ── Menu events → renderer ─────────────────────────────────────────────────
  // The main process sends these when native menu items are clicked.
  onMenuEvent: (
    event: 'menu:new' | 'menu:open' | 'menu:save' | 'menu:saveAs' |
           'menu:exportPdf' | 'menu:exportMusicXml' | 'menu:importMusicXml' | 'menu:undo' | 'menu:redo' |
           'menu:zoomIn' | 'menu:zoomOut' | 'menu:zoomFit' |
           'menu:exportMidi' | 'menu:importMidi',
    handler: () => void
  ) => {
    ipcRenderer.on(event, handler)
    // Return cleanup function (call in useEffect cleanup)
    return () => ipcRenderer.removeListener(event, handler)
  }
})
