import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { DictationEntrySchema, type DictationEntry } from '../../shared/listen'

/** Dictation history: a JSON list, newest first, capped. Unreadable entries are dropped, never fatal. */
export class HistoryStore {
  // Serialise writes so two quick dictations can't lose each other's entry.
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly max = 500
  ) {}

  async list(): Promise<DictationEntry[]> {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(this.file, 'utf8'))
    } catch {
      return []
    }
    if (!Array.isArray(raw)) return []
    return raw.flatMap((e) => {
      const parsed = DictationEntrySchema.safeParse(e)
      return parsed.success ? [parsed.data] : []
    })
  }

  private change(fn: (entries: DictationEntry[]) => DictationEntry[]): Promise<void> {
    const next = this.queue.then(async () => {
      const entries = fn(await this.list()).slice(0, this.max)
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(`${this.file}.tmp`, JSON.stringify(entries, null, 1))
      await rename(`${this.file}.tmp`, this.file)
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  add(entry: DictationEntry): Promise<void> {
    return this.change((all) => [entry, ...all.filter((e) => e.id !== entry.id)])
  }
  update(id: string, patch: Partial<DictationEntry>): Promise<void> {
    return this.change((all) => all.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }
  remove(id: string): Promise<void> {
    return this.change((all) => all.filter((e) => e.id !== id))
  }
  clear(): Promise<void> {
    return this.change(() => [])
  }
}
