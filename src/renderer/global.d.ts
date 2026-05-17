// Extends the Window interface so TypeScript knows about the API
// exposed by the preload script via contextBridge.exposeInMainWorld.

type MenuEvent =
  | 'menu:new' | 'menu:open' | 'menu:save' | 'menu:saveAs'
  | 'menu:exportPdf' | 'menu:exportMusicXml' | 'menu:undo' | 'menu:redo'
  | 'menu:zoomIn' | 'menu:zoomOut' | 'menu:zoomFit'
  | 'menu:exportMidi' | 'menu:importMidi'

interface ElectronAPI {
  platform: string
  openFile:       () => Promise<{ path: string; content: string } | null>
  saveFile:       (path: string, content: string) => Promise<{ success: boolean }>
  saveFileAs:     (content: string) => Promise<{ path: string; success: boolean } | null>
  exportMidi:     (bytes: Uint8Array) => Promise<{ success: boolean }>
  importMidi:     () => Promise<{ bytes: Uint8Array; path: string } | null>
  exportPdf:      (bytes: Uint8Array) => Promise<{ success: boolean }>
  exportMusicXml: (xml: string) => Promise<{ success: boolean }>
  onMenuEvent:    (event: MenuEvent, handler: () => void) => () => void
}

declare interface Window {
  electronAPI: ElectronAPI
}
