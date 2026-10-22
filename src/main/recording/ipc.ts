import { broadcast, getSettings, handle } from '../ipc'
import { remuxCopy } from '../media/ffmpeg'
import { RecordingStore } from './store'

const stores = new Map<string, RecordingStore>()
/** A recording stays with the store (library folder) it started in, even if Settings change mid-way. */
const owners = new Map<string, RecordingStore>()

export function libraryStore(): RecordingStore {
  const dir = getSettings().libraryDir
  let store = stores.get(dir)
  if (!store) {
    store = new RecordingStore(dir, remuxCopy)
    stores.set(dir, store)
  }
  return store
}

const ownerOf = (id: string): RecordingStore => owners.get(id) ?? libraryStore()

export function registerRecordingIpc(): void {
  handle('rec:create', async (_e, init) => {
    const store = libraryStore()
    const created = await store.create(init)
    owners.set(created.id, store)
    return created
  })
  handle('rec:chunk', (_e, id, track, data) => ownerOf(id).appendChunk(id, track, new Uint8Array(data)))
  handle('rec:offset', (_e, id, track, offsetMs) => ownerOf(id).setTrackOffset(id, track, offsetMs))
  handle('rec:disable', (_e, id, track, reason) => ownerOf(id).disableTrack(id, track, reason))
  handle('rec:update', (_e, id, patch) => ownerOf(id).update(id, patch))
  handle('rec:finalize', async (_e, id, durationMs) => {
    const manifest = await ownerOf(id).finalize(id, durationMs)
    owners.delete(id)
    broadcast('library:changed', null)
    return manifest
  })
  handle('rec:abort', async (_e, id) => {
    await ownerOf(id).abort(id)
    owners.delete(id)
    broadcast('library:changed', null)
  })
  handle('rec:list', () => libraryStore().list())
}

/** Mark recordings interrupted by a crash as incomplete (their files are kept and still export). */
export async function recoverInterrupted(): Promise<void> {
  try {
    await libraryStore().recover()
  } catch (err) {
    console.error('Recovery scan failed', err)
  }
}
