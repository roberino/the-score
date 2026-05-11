// Extends the Window interface so TypeScript knows about the API
// exposed by the preload script via contextBridge.exposeInMainWorld.

type MenuEvent =
  | 'menu:new' | 'menu:open' | 'menu:save' | 'menu:saveAs'
  | 'menu:exportPdf' | 'menu:undo' | 'menu:redo'
  | 'menu:zoomIn' | 'menu:zoomOut' | 'menu:zoomFit'

interface ElectronAPI {
  platform: string
  openFile:    () => Promise<{ path: string; content: string } | null>
  saveFile:    (path: string, content: string) => Promise<{ success: boolean }>
  saveFileAs:  (content: string) => Promise<{ path: string; success: boolean } | null>
  onMenuEvent: (event: MenuEvent, handler: () => void) => () => void
}

declare interface Window {
  electronAPI: ElectronAPI
}
