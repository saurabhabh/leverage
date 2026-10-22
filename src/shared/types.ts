import { z } from 'zod'

export type Rect = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }
export type TrackKind = 'screen' | 'camera' | 'mic' | 'system'
export const TRACK_KINDS: readonly TrackKind[] = ['screen', 'camera', 'mic', 'system']

export const HotkeysSchema = z.object({
  toggle: z.string().min(1),
  pause: z.string().min(1),
  abort: z.string().min(1)
})

export const SettingsSchema = z.object({
  libraryDir: z.string().min(1),
  countdownSec: z.number().int().min(0).max(10),
  confirmAbort: z.boolean(),
  hotkeys: HotkeysSchema
})

export type Settings = z.infer<typeof SettingsSchema>
