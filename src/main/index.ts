import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerCoreIpc } from './ipc'
import { recoverInterrupted, registerRecordingIpc } from './recording/ipc'
import { registerOverlayIpc } from './windows/overlay'
import { installDisplayMediaHandler, installPermissionHandlers, registerCaptureIpc } from './capture/ipc'

// Tests run against an isolated profile so they never touch the user's settings or library.
if (process.env['LEVERAGE_USER_DATA']) app.setPath('userData', process.env['LEVERAGE_USER_DATA'])

/** Leverage's own pages: the dev server in development, bundled files otherwise. */
export function isOwnUrl(url: string): boolean {
  const dev = process.env['ELECTRON_RENDERER_URL']
  return url.startsWith('file://') || (!!dev && is.dev && url.startsWith(dev))
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Leverage',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer owns the MediaRecorders; keep them running while minimized.
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.saurabh.leverage')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerCoreIpc()
  registerRecordingIpc()
  registerCaptureIpc()
  registerOverlayIpc()
  installDisplayMediaHandler()
  installPermissionHandlers(isOwnUrl)
  void recoverInterrupted()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
