import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { RecordingManifestSchema, type RecordingManifest, type TrackKind } from '../../shared/types'
import type { CreateInitPayload } from '../../shared/recording'
import { recordingDirName, uniqueDir } from './naming'

export type Remux = (inFile: string, outFile: string) => Promise<void>

export type CreateInit = CreateInitPayload

type Open = { dir: string; manifest: RecordingManifest; queues: Map<string, Promise<void>> }

const MANIFEST = 'recording.json'

/**
 * Owns the on-disk library. Every recording is a new folder holding one file per track plus a
 * manifest. Chunks are appended as they arrive, so a crash loses at most the last second.
 */
export class RecordingStore {
  private open = new Map<string, Open>()

  constructor(
    private root: string,
    private remux: Remux,
    private now: () => Date = () => new Date()
  ) {}

  async create(init: CreateInit): Promise<{ id: string; dir: string }> {
    await mkdir(this.root, { recursive: true })
    const created = this.now()
    const dir = uniqueDir(this.root, recordingDirName(created))
    await mkdir(dir)
    const id = randomUUID()
    const tracks: RecordingManifest['tracks'] = {}
    for (const kind of init.tracks) {
      tracks[kind] = { file: `${kind}.webm`, mime: init.mimes[kind] ?? '', offsetMs: 0 }
    }
    const manifest: RecordingManifest = {
      version: 1,
      id,
      title: `Recording ${recordingDirName(created)}`,
      createdAt: created.toISOString(),
      status: 'recording',
      durationMs: 0,
      source: init.source,
      videoSize: init.videoSize,
      ...(init.crop ? { crop: init.crop } : {}),
      ...(init.bubble ? { bubble: init.bubble } : {}),
      tracks,
      disabledTracks: {}
    }
    this.open.set(id, { dir, manifest, queues: new Map() })
    await this.writeManifest(id)
    return { id, dir }
  }

  appendChunk(id: string, track: TrackKind, data: Uint8Array): Promise<void> {
    let rec: Open
    try {
      rec = this.get(id)
    } catch (err) {
      return Promise.reject(err)
    }
    const entry = rec.manifest.tracks[track]
    if (!entry) return Promise.reject(new Error(`Track ${track} is not part of recording ${id}`))
    return this.enqueue(rec, track, () => appendFile(join(rec.dir, entry.file), data))
  }

  async setTrackOffset(id: string, track: TrackKind, offsetMs: number): Promise<void> {
    const entry = this.get(id).manifest.tracks[track]
    if (entry) entry.offsetMs = offsetMs
    await this.writeManifest(id)
  }

  async update(id: string, patch: Pick<Partial<RecordingManifest>, 'bubble' | 'crop'>): Promise<void> {
    Object.assign(this.get(id).manifest, patch)
    await this.writeManifest(id)
  }

  async disableTrack(id: string, track: TrackKind, reason: string): Promise<void> {
    this.get(id).manifest.disabledTracks[track] = reason
    await this.writeManifest(id)
  }

  async finalize(id: string, durationMs: number): Promise<RecordingManifest> {
    const rec = this.get(id)
    await Promise.all(rec.queues.values())
    for (const kind of Object.keys(rec.manifest.tracks) as TrackKind[]) {
      const entry = rec.manifest.tracks[kind]!
      const file = join(rec.dir, entry.file)
      if (!(await hasData(file))) {
        delete rec.manifest.tracks[kind]
        continue
      }
      // MediaRecorder WebM has no duration or cues; a stream copy makes it seekable.
      const fixed = file.replace(/\.webm$/, '.fixed.webm')
      try {
        await this.remux(file, fixed)
        await rename(fixed, file)
      } catch {
        await rm(fixed, { force: true })
      }
    }
    rec.manifest.status = 'complete'
    rec.manifest.durationMs = durationMs
    await this.writeManifest(id)
    await Promise.all(rec.queues.values())
    this.open.delete(id)
    return rec.manifest
  }

  async abort(id: string): Promise<void> {
    const rec = this.get(id)
    await Promise.allSettled(rec.queues.values())
    this.open.delete(id)
    await rm(rec.dir, { recursive: true, force: true })
  }

  async list(): Promise<RecordingManifest[]> {
    return (await this.scan())
      .map((f) => f.manifest)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** Recordings left in "recording" state by a crash become "incomplete"; their files are kept. */
  async recover(): Promise<string[]> {
    const changed: string[] = []
    for (const { dir, manifest } of await this.scan()) {
      if (manifest.status !== 'recording' || this.open.has(manifest.id)) continue
      manifest.status = 'incomplete'
      await writeManifestFile(dir, manifest)
      changed.push(manifest.id)
    }
    return changed
  }

  async find(id: string): Promise<{ dir: string; manifest: RecordingManifest } | undefined> {
    const rec = this.open.get(id)
    if (rec) return { dir: rec.dir, manifest: rec.manifest }
    return (await this.scan()).find((f) => f.manifest.id === id)
  }

  private async scan(): Promise<{ dir: string; manifest: RecordingManifest }[]> {
    if (!existsSync(this.root)) return []
    const out: { dir: string; manifest: RecordingManifest }[] = []
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(this.root, entry.name)
      try {
        const parsed = RecordingManifestSchema.safeParse(
          JSON.parse(await readFile(join(dir, MANIFEST), 'utf8'))
        )
        if (parsed.success) out.push({ dir, manifest: parsed.data })
      } catch {
        // Not a recording folder.
      }
    }
    return out
  }

  private get(id: string): Open {
    const rec = this.open.get(id)
    if (!rec) throw new Error(`Unknown recording ${id}`)
    return rec
  }

  private enqueue(rec: Open, key: string, task: () => Promise<void>): Promise<void> {
    const next = (rec.queues.get(key) ?? Promise.resolve()).then(task)
    rec.queues.set(
      key,
      next.catch(() => undefined)
    )
    return next
  }

  private writeManifest(id: string): Promise<void> {
    const rec = this.get(id)
    const snapshot = JSON.stringify(rec.manifest, null, 2)
    return this.enqueue(rec, MANIFEST, () => writeManifestText(rec.dir, snapshot))
  }
}

function writeManifestFile(dir: string, manifest: RecordingManifest): Promise<void> {
  return writeManifestText(dir, JSON.stringify(manifest, null, 2))
}

async function writeManifestText(dir: string, text: string): Promise<void> {
  const temp = join(dir, `${MANIFEST}.tmp`)
  await writeFile(temp, text)
  await rename(temp, join(dir, MANIFEST))
}

async function hasData(file: string): Promise<boolean> {
  try {
    return (await stat(file)).size > 0
  } catch {
    return false
  }
}
