import { net, protocol } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { RecordingManifest, TrackKind } from '../../shared/types'
import { TRACK_KINDS } from '../../shared/types'
import { relativeOffsets } from '../../shared/edit'
import { handle } from '../ipc'
import { libraryStore } from '../recording/ipc'
import { probeDurationSeconds } from '../media/probe'
import { loadEdit, saveEdit, writeOverlayPng } from './store'

export const MEDIA_SCHEME = 'leverage-media'

/** Must run before app ready: lets <video> stream and seek leverage-media:// URLs. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
  ])
}

/** Source length of a recording without a stored duration (recovered after a crash). */
async function probeMs(dir: string, m: RecordingManifest): Promise<number> {
  const offsets = relativeOffsets(m)
  const ends = await Promise.all(
    (Object.entries(m.tracks) as [TrackKind, { file: string }][]).map(async ([k, t]) => {
      const secs = await probeDurationSeconds(join(dir, t.file)).catch(() => 0)
      return (offsets[k] ?? 0) + secs * 1000
    })
  )
  return Math.max(...ends, 100)
}

/** id → recording folder, so media requests (many per second while seeking) don't rescan the library. */
const dirs = new Map<string, { dir: string; manifest: RecordingManifest }>()

async function recording(id: string): Promise<{ dir: string; manifest: RecordingManifest }> {
  const cached = dirs.get(id)
  if (cached) return cached
  const found = await libraryStore().find(id)
  if (!found) throw new Error('Recording not found.')
  dirs.set(id, found)
  return found
}

export function registerEditIpc(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const track = url.pathname.replace(/^\//, '') as TrackKind
    try {
      const { dir, manifest } = await recording(url.hostname)
      const entry = TRACK_KINDS.includes(track) ? manifest.tracks[track] : undefined
      if (!entry) return new Response('Not found', { status: 404 })
      // net.fetch on a file URL honours Range requests, so the player can seek.
      return net.fetch(pathToFileURL(join(dir, entry.file)).toString(), { headers: request.headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  handle('edit:open', async (_e, id) => {
    dirs.delete(id)
    const { dir, manifest } = await recording(id)
    const loaded = await loadEdit(dir, manifest, () => probeMs(dir, manifest))
    return { manifest, dir, ...loaded }
  })
  handle('edit:save', async (_e, id, edit) => saveEdit((await recording(id)).dir, edit))
  handle('edit:overlayPng', async (_e, id, overlayId, data) => {
    await writeOverlayPng((await recording(id)).dir, overlayId, new Uint8Array(data))
  })
  handle('edit:mediaUrl', (_e, id, track) => `${MEDIA_SCHEME}://${encodeURIComponent(id)}/${track}`)
}
