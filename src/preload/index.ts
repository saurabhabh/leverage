import { contextBridge, ipcRenderer } from 'electron'
import { INVOKE_CHANNELS, EVENT_CHANNELS, type LeverageApi } from '../shared/ipc'

const api: Record<string, unknown> = {}
for (const channel of INVOKE_CHANNELS) {
  api[channel] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
}
api.on = (channel: string, listener: (payload: unknown) => void) => {
  if (!(EVENT_CHANNELS as readonly string[]).includes(channel)) throw new Error(`Unknown event ${channel}`)
  const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

contextBridge.exposeInMainWorld('leverage', api as unknown as LeverageApi)
