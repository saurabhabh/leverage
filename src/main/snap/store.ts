import { existsSync, mkdirSync } from 'fs'
import { readdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { SnapDocSchema, type SnapDoc, type SnapEntry } from '../../shared/snap'
import type { Size } from '../../shared/types'
import { snapBaseName, snapIdCandidates } from './naming'

/** Hidden folder beside the PNGs holding each shot's original pixels and shape list. */
export const SIDECAR = '.leverage'

const assertId = (id: string): void => {
  if (!id || id === '.' || id === '..' || /[\\/:]/.test(id)) throw new Error('Invalid shot id')
}

async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  const temp = `${file}.tmp`
  await writeFile(temp, data)
  await rename(temp, file)
}

/**
 * Screenshots in one folder: `<id>.png` is what the user sees and shares; `.leverage/<id>/` keeps
 * `original.png` and `snap.json` so the shot can be re-edited. Nothing the user made is overwritten.
 */
export class SnapStore {
  constructor(
    readonly root: string,
    private readonly trash: (path: string) => Promise<void>
  ) {}

  private sidecar(id: string): string {
    assertId(id)
    return join(this.root, SIDECAR, id)
  }

  pngPath(id: string): string {
    assertId(id)
    return join(this.root, `${id}.png`)
  }

  /** Reserve a fresh id by creating its sidecar folder (fails if it exists, so two shots never share one). */
  private reserve(now: Date): string {
    mkdirSync(join(this.root, SIDECAR), { recursive: true })
    for (const id of snapIdCandidates(snapBaseName(now))) {
      if (existsSync(this.pngPath(id))) continue
      try {
        mkdirSync(this.sidecar(id))
        return id
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }
    }
    throw new Error('unreachable')
  }

  async create(png: Buffer, size: Size, now = new Date()): Promise<SnapDoc> {
    const id = this.reserve(now)
    const doc: SnapDoc = {
      version: 1,
      id,
      file: `${id}.png`,
      createdAt: now.toISOString(),
      width: size.width,
      height: size.height,
      shapes: []
    }
    await writeFile(join(this.sidecar(id), 'original.png'), png)
    await writeFile(join(this.sidecar(id), 'snap.json'), JSON.stringify(doc, null, 2))
    await writeFile(this.pngPath(id), png)
    return doc
  }

  async get(id: string): Promise<SnapDoc | null> {
    const file = join(this.sidecar(id), 'snap.json')
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      return null
    }
    try {
      const parsed = SnapDocSchema.safeParse(JSON.parse(raw))
      return parsed.success && parsed.data.id === id ? parsed.data : null
    } catch {
      return null
    }
  }

  /** Newest first. Shots with an unreadable doc, or whose PNG the user deleted, are left out. */
  async list(): Promise<SnapEntry[]> {
    let names: string[]
    try {
      names = await readdir(join(this.root, SIDECAR))
    } catch {
      return []
    }
    const entries: SnapEntry[] = []
    for (const name of names) {
      let doc: SnapDoc | null
      try {
        doc = await this.get(name)
      } catch {
        continue
      }
      if (!doc || !existsSync(this.pngPath(doc.id))) continue
      const { id, file, createdAt, width, height } = doc
      entries.push({ id, file, createdAt, width, height })
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** Store an edit. Identity fields (id, file, size, date) always come from the stored doc. */
  async save(id: string, next: SnapDoc, renderedPng: Buffer): Promise<SnapDoc> {
    const current = await this.get(id)
    if (!current) throw new Error('Screenshot not found.')
    const { id: _id, file, createdAt, width, height } = current
    const doc = SnapDocSchema.parse({ ...next, id: _id, file, createdAt, width, height })
    await writeAtomic(this.pngPath(id), renderedPng)
    await writeAtomic(join(this.sidecar(id), 'snap.json'), JSON.stringify(doc, null, 2))
    return doc
  }

  image(id: string, which: 'original' | 'rendered'): Promise<Buffer> {
    return readFile(
      which === 'original' ? join(this.sidecar(id), 'original.png') : this.pngPath(id)
    )
  }

  async remove(id: string): Promise<void> {
    if (existsSync(this.pngPath(id))) await this.trash(this.pngPath(id))
    await this.trash(this.sidecar(id))
  }
}
