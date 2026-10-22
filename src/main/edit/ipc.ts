import { execFile } from 'child_process'
import { net, protocol } from 'electron'
import ffprobeStatic from 'ffprobe-static'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { RecordingManifest, TrackKind } from '../../shared/types'
import { TRACK_KINDS } from '../../shared/types'
import { handle } from '../ipc'
import { libraryStore } from '../recording/ipc'
import { loadEdit, saveEdit, writeOverlayPng } from './store'

export const MEDIA_SCHEME = 'leverage-media'

/** Must run before app ready: lets <video> stream and seek leverage-media:// URLs. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
  ])
}

const ffprobePath = (): string => ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked')

function probeSeconds(file: string): Promise<number> {
  return new Promise((resolve, reject) =>
    execFile(
      ffprobePath(),
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { windowsHide: true },
      (err, stdout) => {
        const n = Number(String(stdout).trim())
        if (err || !Number.isFinite(n)) reject(err ?? new Error('No duration'))
        else resolve(n)
      }
    )
  )
}

/** Duration of a recording without a stored one (recovered after a crash): its longest track. */
async function probeMs(dir: string, m: RecordingManifest): Promise<number> {
  const files = Object.values(m.tracks).map((t) => join(dir, t.file))
  const secs = await Promise.all(files.map((f) => probeSeconds(f).catch(() => 0)))
  return Math.max(...secs, 0.1) * 1000
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
