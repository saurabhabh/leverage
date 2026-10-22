import { z } from 'zod'

export type Rect = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }
export type TrackKind = 'screen' | 'camera' | 'mic' | 'system'
export const TRACK_KINDS: readonly TrackKind[] = ['screen', 'camera', 'mic', 'system']

export type CaptureSource = {
  id: string
  kind: 'screen' | 'window'
  name: string
  thumbnailDataUrl: string
  displayId?: string
  displayBoundsDip?: Rect
  scaleFactor: number
}

export const HotkeysSchema = z.object({
  toggle: z.string().min(1),
  pause: z.string().min(1),
  abort: z.string().min(1)
})

export const AiSettingsSchema = z.object({
  transcription: z.enum(['local', 'groq']),
  suggestions: z.enum(['groq', 'openrouter']),
  groqChatModel: z.string().min(1),
  openrouterModel: z.string().min(1)
})

export const SettingsSchema = z.object({
  libraryDir: z.string().min(1),
  countdownSec: z.number().int().min(0).max(10),
  confirmAbort: z.boolean(),
  hotkeys: HotkeysSchema,
  ai: AiSettingsSchema
})

export type Settings = z.infer<typeof SettingsSchema>

const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
})
const TrackKindSchema = z.enum(['screen', 'camera', 'mic', 'system'])
const TrackSchema = z.object({ file: z.string(), mime: z.string(), offsetMs: z.number() })

export const RecordingManifestSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  status: z.enum(['recording', 'complete', 'incomplete']),
  durationMs: z.number(),
  source: z.object({
    kind: z.enum(['screen', 'window']),
    name: z.string(),
    displayBoundsDip: RectSchema.optional(),
    scaleFactor: z.number()
  }),
  videoSize: z.object({ width: z.number(), height: z.number() }),
  /** In captured-video pixels. */
  crop: RectSchema.optional(),
  /** Camera bubble position in DIP, relative to the recorded display's origin. */
  bubble: z.object({ xDip: z.number(), yDip: z.number(), sizeDip: z.number() }).optional(),
  tracks: z.partialRecord(TrackKindSchema, TrackSchema),
  /** Track → human-readable reason it is missing. */
  disabledTracks: z.partialRecord(TrackKindSchema, z.string())
})

export type RecordingManifest = z.infer<typeof RecordingManifestSchema>
