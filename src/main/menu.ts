import { BrowserWindow, Menu, MenuItemConstructorOptions, shell } from 'electron'

export function buildAppMenu(win: BrowserWindow): Menu {
  const isMac = process.platform === 'darwin'
  const send = (channel: string) => { if (!win.isDestroyed()) send(channel) }

  const template: MenuItemConstructorOptions[] = [
    // macOS app menu
    ...(isMac ? [{
      label: 'Notation App',
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Score',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('menu:new')
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('menu:open')
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('menu:save')
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('menu:saveAs')
        },
        { type: 'separator' },
        {
          label: 'Export as PDF…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => send('menu:exportPdf')
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => send('menu:undo')
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => send('menu:redo')
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => send('menu:zoomIn')
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => send('menu:zoomOut')
        },
        {
          label: 'Zoom to Fit',
          accelerator: 'CmdOrCtrl+0',
          click: () => send('menu:zoomFit')
        },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://github.com/yourname/notation-app#readme')
        }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
