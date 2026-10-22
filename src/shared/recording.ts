import type { RecordingManifest, TrackKind } from './types'

/** What the renderer sends to start a recording folder (serializable twin of the store's CreateInit). */
export type CreateInitPayload = Pick<RecordingManifest, 'source' | 'videoSize' | 'crop' | 'bubble'> & {
  tracks: TrackKind[]
  mimes: Partial<Record<TrackKind, string>>
}
