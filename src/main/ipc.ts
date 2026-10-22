import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import type { InvokeApi, InvokeChannel, EventChannel, EventMap } from '../shared/ipc'
import { loadSettings, saveSettings } from './settings'
import type { Settings } from '../shared/types'

type Handler<C extends InvokeChannel> = (
  event: Electron.IpcMainInvokeEvent,
  ...args: Parameters<InvokeApi[C]>
) => ReturnType<InvokeApi[C]> | Awaited<ReturnType<InvokeApi[C]>>

let isTrustedSender: (url: string) => boolean = () => false

/** Only Leverage's own pages may call into the main process. */
export const setSenderGuard = (guard: (url: string) => boolean): void => {
  isTrustedSender = guard
}

export function handle<C extends InvokeChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, (event, ...args) => {
    const url = event.senderFrame?.url ?? ''
    if (!isTrustedSender(url)) throw new Error(`Blocked ${channel} from ${url || 'unknown sender'}`)
    return handler(event, ...(args as Parameters<InvokeApi[C]>))
  })
}

export function broadcast<C extends EventChannel>(channel: C, payload: EventMap[C]): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

export const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

let current: Settings | undefined
const settingsListeners: ((s: Settings) => void)[] = []
export const onSettingsChanged = (fn: (s: Settings) => void): void => void settingsListeners.push(fn)

export function getSettings(): Settings {
  current ??= loadSettings(settingsFile(), app.getPath('home'))
  return current
}

export function registerCoreIpc(): void {
  handle('settings:get', () => getSettings())
  handle('settings:set', (_e, settings) => {
    saveSettings(settingsFile(), settings)
    current = loadSettings(settingsFile(), app.getPath('home'))
    broadcast('settings:changed', current)
    settingsListeners.forEach((fn) => fn(current!))
    return current
  })
  handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  handle('window:restore', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  handle('dialog:pickFolder', async (event, defaultPath) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}
