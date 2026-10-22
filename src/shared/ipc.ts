import type { CaptureSource, RecordingManifest, Rect, Settings, TrackKind } from './types'

export type RegionPick = { displayId: string; rectDip: Rect }
import type { CreateInitPayload } from './recording'

/**
 * Single source of truth for renderer → main calls. Each key is both the IPC channel and the
 * method name on `window.leverage`. Later tasks add entries here and a handler in main.
 */
export interface InvokeApi {
  'settings:get': () => Promise<Settings>
  'settings:set': (settings: Settings) => Promise<Settings>
  'dialog:pickFolder': (defaultPath?: string) => Promise<string | null>

  'rec:create': (init: CreateInitPayload) => Promise<{ id: string; dir: string }>
  'rec:chunk': (id: string, track: TrackKind, data: ArrayBuffer) => Promise<void>
  'rec:offset': (id: string, track: TrackKind, offsetMs: number) => Promise<void>
  'rec:disable': (id: string, track: TrackKind, reason: string) => Promise<void>
  'rec:update': (id: string, patch: Pick<Partial<RecordingManifest>, 'bubble' | 'crop'>) => Promise<void>
  'rec:finalize': (id: string, durationMs: number) => Promise<RecordingManifest>
  'rec:abort': (id: string) => Promise<void>
  'rec:list': () => Promise<RecordingManifest[]>

  'capture:list': () => Promise<CaptureSource[]>
  'capture:select': (sourceId: string) => Promise<void>

  'window:minimize': () => Promise<void>
  'window:restore': () => Promise<void>

  'region:pick': () => Promise<RegionPick | null>
  'region:submit': (result: RegionPick | null) => Promise<void>
}

export type InvokeChannel = keyof InvokeApi

export const INVOKE_CHANNELS: readonly InvokeChannel[] = [
  'settings:get',
  'settings:set',
  'dialog:pickFolder',
  'rec:create',
  'rec:chunk',
  'rec:offset',
  'rec:disable',
  'rec:update',
  'rec:finalize',
  'rec:abort',
  'rec:list',
  'capture:list',
  'capture:select',
  'window:minimize',
  'window:restore',
  'region:pick',
  'region:submit'
]

/** Main → renderer events. */
export interface EventMap {
  'settings:changed': Settings
  'library:changed': null
}

export type EventChannel = keyof EventMap

export const EVENT_CHANNELS: readonly EventChannel[] = ['settings:changed', 'library:changed']

export type LeverageApi = InvokeApi & {
  on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void
}
