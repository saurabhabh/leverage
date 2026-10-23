import { BrowserWindow, screen } from 'electron'
import { escape } from '../escape'
import type { RegionPick } from '../../shared/ipc'
import { handle } from '../ipc'
import { helperWebPreferences, loadPage } from './load'

let pending: { resolve: (r: RegionPick | null) => void; windows: BrowserWindow[] } | null = null

function finish(result: RegionPick | null): void {
  if (!pending) return
  const { resolve, windows } = pending
  pending = null
  escape.release('region')
  for (const w of windows) if (!w.isDestroyed()) w.close()
  resolve(result)
}

/** Open a dimmed overlay on every display; resolves with the dragged rect (global DIP) or null. */
function pickRegion(): Promise<RegionPick | null> {
  finish(null)
  return new Promise((resolve) => {
    const windows = screen.getAllDisplays().map((display) => {
      const win = new BrowserWindow({
        ...display.bounds,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        show: false,
        webPreferences: helperWebPreferences()
      })
      win.setAlwaysOnTop(true, 'screen-saver')
      // Never appear in any capture, including the one about to start.
      win.setContentProtection(true)
      win.setBounds(display.bounds)
      win.once('ready-to-show', () => {
        win.show()
        win.focus()
      })
      win.on('closed', () => {
        if (pending?.windows.includes(win)) finish(null)
      })
      void loadPage(win, 'overlay.html', {
        displayId: String(display.id),
        x: String(display.bounds.x),
        y: String(display.bounds.y)
      })
      return win
    })
    pending = { resolve, windows }
    // Esc cancels even if an overlay has not taken keyboard focus yet.
    escape.hold('region', () => finish(null))
  })
}

export function registerOverlayIpc(): void {
  handle('region:pick', () => pickRegion())
  handle('region:submit', (_e, result) => finish(result))
}
