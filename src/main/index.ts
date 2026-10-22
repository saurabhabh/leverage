import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import trayIcon from '../../resources/icon.png?asset'
import { onSettingsChanged, registerCoreIpc, setSenderGuard } from './ipc'
import { isOwnUrl as isOwnUrlIn } from './security'
import { initControl, registerHotkeysFromSettings } from './control'
import { recoverInterrupted, registerRecordingIpc } from './recording/ipc'
import { registerOverlayIpc } from './windows/overlay'
import { registerExportIpc } from './media/exportIpc'
import { registerEditIpc, registerMediaScheme } from './edit/ipc'
import { registerKeyIpc } from './ai/keys'
import { registerWhisperIpc } from './whisper/ipc'
import { registerTranscribeIpc } from './transcribe/ipc'
import { registerSnapIpc } from './snap/ipc'
import { registerListenIpc } from './listen/ipc'
import { recoverNotes, registerNotesIpc } from './listen/notesIpc'
import {
  installDisplayMediaHandler,
  installPermissionHandlers,
  registerCaptureIpc
} from './capture/ipc'

registerMediaScheme()

// Tests run against an isolated profile so they never touch the user's settings or library.
if (process.env['LEVERAGE_USER_DATA']) app.setPath('userData', process.env['LEVERAGE_USER_DATA'])

const rendererDir = join(__dirname, '../renderer')

/** Leverage's own pages: bundled renderer files, or the dev server in development. */
export const isOwnUrl = (url: string): boolean =>
  isOwnUrlIn(url, rendererDir, is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined)

// Every window: never navigate away from Leverage (Electron otherwise opens a file dropped on the
// window, replacing the recorder), and only open https links, in the default browser.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!isOwnUrl(url)) event.preventDefault()
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
})

let mainWindow: BrowserWindow | undefined

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
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

  win.on('ready-to-show', () => win.show())
  // The recorder lives in this window; closing it quits Leverage (helpers and tray included).
  win.on('closed', () => {
    mainWindow = undefined
    app.quit()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.saurabh.leverage')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setSenderGuard(isOwnUrl)
  registerCoreIpc()
  registerRecordingIpc()
  registerCaptureIpc()
  registerOverlayIpc()
  registerExportIpc()
  registerEditIpc()
  registerKeyIpc()
  registerWhisperIpc()
  registerTranscribeIpc()
  registerSnapIpc(() => mainWindow)
  registerListenIpc()
  registerNotesIpc()
  installDisplayMediaHandler()
  installPermissionHandlers(isOwnUrl)
  void recoverInterrupted()
  void recoverNotes().catch(() => undefined)

  mainWindow = createWindow()
  initControl(() => mainWindow, trayIcon)
  onSettingsChanged(registerHotkeysFromSettings)

  app.on('activate', function () {
    if (!mainWindow) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
