import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/** Load one of the renderer's HTML entry points (dev server in development, bundled file otherwise). */
export function loadPage(win: BrowserWindow, page: string, query: Record<string, string> = {}): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    const url = new URL(`${devUrl}/${page}`)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    return win.loadURL(url.toString())
  }
  return win.loadFile(join(__dirname, '../renderer', page), { query })
}

export const preloadPath = (): string => join(__dirname, '../preload/index.js')

/** Shared settings for Leverage's small helper windows (overlay, toolbar, bubble). */
export const helperWebPreferences = (): Electron.WebPreferences => ({
  preload: preloadPath(),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false
})
