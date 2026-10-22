import { existsSync } from 'fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { NoteDocSchema, type NoteDoc, type NoteEntry } from '../../shared/listen'
import { recordingDirName, uniqueDir } from '../recording/naming'

const assertId = (id: string): void => {
  if (!id || id === '.' || id === '..' || /[\\/:]/.test(id)) throw new Error('Invalid note id')
}
type NotePatch = Partial<Omit<NoteDoc, 'id' | 'version' | 'createdAt'>>

const safeTitle = (t: string): string =>
  t
    .replace(/[<>:"/\\|?*]+/g, '-')
    .trim()
    .slice(0, 60)

/**
 * Listen notes, one folder each under the notes folder: `note.json` plus any meeting audio. Writes are
 * queued so the recorder, the transcriber and the user's typing never overwrite each other.
 */
export class NotesStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    readonly root: string,
    private readonly trash: (path: string) => Promise<void>
  ) {}

  dir(id: string): string {
    assertId(id)
    return join(this.root, id)
  }

  private file(id: string): string {
    return join(this.dir(id), 'note.json')
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async write(doc: NoteDoc): Promise<NoteDoc> {
    const parsed = NoteDocSchema.parse(doc)
    const temp = `${this.file(doc.id)}.tmp`
    await writeFile(temp, JSON.stringify(parsed, null, 2))
    await rename(temp, this.file(doc.id))
    return parsed
  }

  create(init: { title: string; source: NoteDoc['source'] }, now = new Date()): Promise<NoteDoc> {
    return this.serial(async () => {
      await mkdir(this.root, { recursive: true })
      const base = [recordingDirName(now), safeTitle(init.title)].filter(Boolean).join(' ')
      const dir = uniqueDir(this.root, base)
      await mkdir(dir)
      return this.write({
        version: 1,
        id: basename(dir),
        title: init.title,
        createdAt: now.toISOString(),
        source: init.source,
        status: 'recording',
        tracks: {},
        notes: '',
        transcript: null,
        summary: null,
        warnings: []
      })
    })
  }

  async get(id: string): Promise<NoteDoc | null> {
    const file = this.file(id)
    try {
      const parsed = NoteDocSchema.safeParse(JSON.parse(await readFile(file, 'utf8')))
      return parsed.success && parsed.data.id === id ? parsed.data : null
    } catch {
      return null
    }
  }

  async list(): Promise<NoteEntry[]> {
    if (!existsSync(this.root)) return []
    const out: NoteEntry[] = []
    for (const name of await readdir(this.root)) {
      let doc: NoteDoc | null
      try {
        doc = await this.get(name)
      } catch {
        continue
      }
      if (doc)
        out.push({
          id: doc.id,
          title: doc.title,
          createdAt: doc.createdAt,
          status: doc.status,
          source: doc.source
        })
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** Main-process changes. A function patch is computed from the current doc inside the write queue. */
  update(id: string, patch: NotePatch | ((doc: NoteDoc) => NotePatch)): Promise<NoteDoc> {
    return this.serial(async () => {
      const doc = await this.get(id)
      if (!doc) throw new Error('Note not found.')
      return this.write({ ...doc, ...(typeof patch === 'function' ? patch(doc) : patch) })
    })
  }

  /** What the user may change from the page: the title and their own notes, nothing else. */
  saveUser(id: string, patch: { title?: string; notes?: string }): Promise<NoteDoc> {
    const clean: { title?: string; notes?: string } = {}
    if (typeof patch.title === 'string' && patch.title.trim()) clean.title = patch.title.trim()
    if (typeof patch.notes === 'string') clean.notes = patch.notes
    return this.update(id, clean)
  }

  async remove(id: string): Promise<void> {
    await this.trash(this.dir(id))
  }
}
