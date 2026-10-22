import { BrowserWindow, dialog, globalShortcut, screen } from 'electron'
import type { RecorderCommand, RecorderStatus } from '../shared/ipc'
import type { Settings } from '../shared/types'
import { broadcast, getSettings, handle } from './ipc'
import { registerHotkeys } from './hotkeys'
import { createTray, updateTray } from './tray'
import { hideToolbar, showToolbar } from './windows/toolbar'
import { bubblePlacement, hideBubble, resizeBubble, showBubble } from './windows/bubble'

/**
 * Keeps the helpers (toolbar, camera bubble, tray, hotkeys) in step with the recorder, which lives
 * in the main window's renderer. Commands from helpers go to that renderer; it reports status back.
 */
let mainWindow: () => BrowserWindow | undefined = () => undefined
let status: RecorderStatus = { phase: 'idle', elapsedMs: 0 }
let failedHotkeys: string[] = []
let confirming = false
let registered: string[] = []

const displayFor = (s: RecorderStatus): Electron.Display =>
  screen.getAllDisplays().find((d) => String(d.id) === s.displayId) ?? screen.getPrimaryDisplay()

function openMain(): void {
  const win = mainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

async function command(c: RecorderCommand): Promise<void> {
  if (c === 'abort') {
    if (status.phase === 'idle' || confirming) return
    if (getSettings().confirmAbort) {
      confirming = true
      try {
        const { response } = await dialog.showMessageBox({
          type: 'question',
          title: 'Leverage',
          message: 'Discard this recording?',
          buttons: ['Discard', 'Keep recording'],
          defaultId: 1,
          cancelId: 1
        })
        if (response !== 0) return
      } finally {
        confirming = false
      }
    }
  }
  if (c === 'toggle' && status.phase === 'idle') openMain()
  mainWindow()?.webContents.send('recorder:command', c)
}

const trayActions = { command: (c: RecorderCommand) => void command(c), open: openMain }

function applyStatus(next: RecorderStatus): void {
  status = next
  const active = next.phase === 'recording' || next.phase === 'paused' || next.phase === 'countdown'
  const display = displayFor(next)
  if (active) showToolbar(display.workArea)
  else hideToolbar()
  if (next.cameraId && (active || next.phase === 'saving')) showBubble(next.cameraId, display.bounds, display.workArea)
  else hideBubble()
  updateTray(next, trayActions)
  broadcast('recorder:status', next)
}

export function registerHotkeysFromSettings(settings: Settings): void {
  registered.forEach((a) => globalShortcut.unregister(a))
  failedHotkeys = registerHotkeys(settings.hotkeys, (c) => void command(c), (a, cb) => globalShortcut.register(a, cb))
  registered = Object.values(settings.hotkeys).filter((a) => !failedHotkeys.includes(a))
}

export function initControl(getMain: () => BrowserWindow | undefined, trayIcon: string): void {
  mainWindow = getMain
  createTray(trayIcon, trayActions)
  registerHotkeysFromSettings(getSettings())
  handle('recorder:status', (_e, next) => applyStatus(next))
  handle('recorder:command', (_e, c) => command(c))
  handle('bubble:placement', () => bubblePlacement())
  handle('bubble:resize', (_e, size) => resizeBubble(size))
  handle('hotkeys:failed', () => failedHotkeys)
}
