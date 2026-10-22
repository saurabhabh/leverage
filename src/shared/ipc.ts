import type { Settings } from './types'

/**
 * Single source of truth for renderer → main calls. Each key is both the IPC channel and the
 * method name on `window.leverage`. Later tasks add entries here and a handler in main/ipc.ts.
 */
export interface InvokeApi {
  'settings:get': () => Promise<Settings>
  'settings:set': (settings: Settings) => Promise<Settings>
  'dialog:pickFolder': (defaultPath?: string) => Promise<string | null>
}

export type InvokeChannel = keyof InvokeApi

export const INVOKE_CHANNELS: readonly InvokeChannel[] = [
  'settings:get',
  'settings:set',
  'dialog:pickFolder'
]

/** Main → renderer events. */
export interface EventMap {
  'settings:changed': Settings
}

export type EventChannel = keyof EventMap

export const EVENT_CHANNELS: readonly EventChannel[] = ['settings:changed']

export type LeverageApi = InvokeApi & {
  on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void
}
