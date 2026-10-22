import { describe, test, expect, beforeEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { snapBaseName } from '../../src/main/snap/naming'
import { SnapStore } from '../../src/main/snap/store'

let root: string
let trashed: string[]
let store: SnapStore
const png = (fill: number): Buffer => Buffer.alloc(64, fill)
const at = new Date(2026, 9, 22, 14, 5, 9)

beforeEach(() => {
  root = join(mkdtempSync(join(tmpdir(), 'lev-snap-')), 'Pictures', 'Leverage')
  trashed = []
  store = new SnapStore(root, async (p) => {
    trashed.push(p)
    rmSync(p, { recursive: true, force: true })
  })
})

describe('naming', () => {
  test('date-and-seconds base name', () => {
    expect(snapBaseName(at)).toBe('2026-10-22_14-05-09')
  })
})

describe('SnapStore', () => {
  test('create writes the visible PNG, the original and the doc, creating the folder', async () => {
    const doc = await store.create(png(1), { width: 800, height: 600 }, at)
    expect(doc).toMatchObject({
      version: 1,
      id: '2026-10-22_14-05-09',
      file: '2026-10-22_14-05-09.png',
      width: 800,
      height: 600,
      shapes: []
    })
    expect(readFileSync(join(root, '2026-10-22_14-05-09.png'))).toEqual(png(1))
    expect(readFileSync(join(root, '.leverage', '2026-10-22_14-05-09', 'original.png'))).toEqual(
      png(1)
    )
    expect(
      JSON.parse(readFileSync(join(root, '.leverage', '2026-10-22_14-05-09', 'snap.json'), 'utf8'))
        .id
    ).toBe(doc.id)
  })

  test('same-second shots and a user file with the same name are never overwritten', async () => {
    await store.create(png(1), { width: 1, height: 1 }, at)
    const second = await store.create(png(2), { width: 1, height: 1 }, at)
    expect(second.id).toBe('2026-10-22_14-05-09 (2)')
    // A PNG the user put there themselves also counts as taken.
    writeFileSync(join(root, '2026-10-22_14-05-09 (3).png'), 'mine')
    const third = await store.create(png(3), { width: 1, height: 1 }, at)
    expect(third.id).toBe('2026-10-22_14-05-09 (4)')
    expect(readFileSync(join(root, '2026-10-22_14-05-09 (3).png'), 'utf8')).toBe('mine')
    expect(readFileSync(join(root, '2026-10-22_14-05-09.png'))).toEqual(png(1))
  })

  test('list is newest first and skips corrupt docs and shots whose PNG was deleted', async () => {
    const a = await store.create(png(1), { width: 1, height: 1 }, new Date(2026, 0, 1))
    const b = await store.create(png(2), { width: 1, height: 1 }, new Date(2026, 5, 1))
    const c = await store.create(png(3), { width: 1, height: 1 }, new Date(2026, 3, 1))
    const d = await store.create(png(4), { width: 1, height: 1 }, new Date(2026, 2, 1))
    writeFileSync(join(root, '.leverage', c.id, 'snap.json'), '{oops')
    rmSync(join(root, d.file))
    expect((await store.list()).map((e) => e.id)).toEqual([b.id, a.id])
  })

  test('list of a folder that does not exist yet is empty', async () => {
    expect(await new SnapStore(join(root, 'nope'), async () => {}).list()).toEqual([])
  })

  test('save replaces the doc and rendered PNG but keeps the original', async () => {
    const doc = await store.create(png(1), { width: 10, height: 10 }, at)
    const edited = {
      ...doc,
      shapes: [{ id: 's', kind: 'counter' as const, color: '#f00', size: 3, at: { x: 1, y: 1 } }]
    }
    await store.save(doc.id, edited, png(9))
    expect(await store.get(doc.id)).toEqual(edited)
    expect(await store.image(doc.id, 'rendered')).toEqual(png(9))
    expect(await store.image(doc.id, 'original')).toEqual(png(1))
  })

  test('save cannot rename, resize or re-point a shot', async () => {
    const doc = await store.create(png(1), { width: 10, height: 10 }, at)
    await store.save(
      doc.id,
      { ...doc, id: 'other', file: '../evil.png', width: 99, createdAt: 'x' },
      png(2)
    )
    const saved = await store.get(doc.id)
    expect(saved).toMatchObject({ id: doc.id, file: doc.file, width: 10, createdAt: doc.createdAt })
    expect(existsSync(join(root, '..', 'evil.png'))).toBe(false)
  })

  test('save rejects an invalid doc', async () => {
    const doc = await store.create(png(1), { width: 10, height: 10 }, at)
    await expect(
      store.save(doc.id, { ...doc, shapes: [{ kind: 'laser' }] } as never, png(2))
    ).rejects.toThrow()
    expect(await store.image(doc.id, 'rendered')).toEqual(png(1))
  })

  test('ids that could escape the folder are rejected', async () => {
    for (const bad of ['..', '../x', 'a\\b', 'a/b', '', 'C:x']) {
      await expect(store.get(bad)).rejects.toThrow('Invalid shot id')
    }
  })

  test('get of an unknown id is null; remove sends the PNG and sidecar to the trash', async () => {
    expect(await store.get('nope')).toBeNull()
    const doc = await store.create(png(1), { width: 1, height: 1 }, at)
    await store.remove(doc.id)
    expect(trashed).toEqual([join(root, doc.file), join(root, '.leverage', doc.id)])
    expect(await store.list()).toEqual([])
  })
})
