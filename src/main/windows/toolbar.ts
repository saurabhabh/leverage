import { BrowserWindow } from 'electron'
import type { Rect } from '../../shared/types'
import { toolbarBounds } from '../../shared/placement'
import { helperWebPreferences, loadPage } from './load'

let toolbar: BrowserWindow | null = null

/** Floating recording toolbar: timer, pause/resume, stop, abort. Never appears in the capture. */
export function showToolbar(display: Rect): void {
  if (toolbar && !toolbar.isDestroyed()) {
    toolbar.setBounds(toolbarBounds(display))
    toolbar.showInactive()
    return
  }
  toolbar = new BrowserWindow({
    ...toolbarBounds(display),
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: helperWebPreferences()
  })
  toolbar.setAlwaysOnTop(true, 'screen-saver')
  toolbar.setContentProtection(true)
  toolbar.once('ready-to-show', () => toolbar?.showInactive())
  toolbar.on('closed', () => (toolbar = null))
  void loadPage(toolbar, 'toolbar.html')
}

export function hideToolbar(): void {
  if (toolbar && !toolbar.isDestroyed()) toolbar.close()
  toolbar = null
}
