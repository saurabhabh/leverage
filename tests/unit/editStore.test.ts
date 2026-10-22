import { test, expect, beforeEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadEdit, saveEdit, writeOverlayPng } from '../../src/main/edit/store'
import type { RecordingManifest } from '../../src/shared/types'

let dir: string
const manifest = (durationMs: number): RecordingManifest => ({
  version: 1,
  id: 'r',
  title: 't',
  createdAt: '2026-10-22T00:00:00.000Z',
  status: 'complete',
  durationMs,
  source: { kind: 'screen', name: 's', scaleFactor: 1, displayBoundsDip: { x: 0, y: 0, width: 1280, height: 720 } },
  videoSize: { width: 1280, height: 720 },
  tracks: {
    screen: { file: 'screen.webm', mime: 'x', offsetMs: 0 },
    camera: { file: 'camera.webm', mime: 'x', offsetMs: 0 }
  },
  disabledTracks: {}
})
const noProbe = async (): Promise<number> => {
  throw new Error('should not probe')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lev-edit-'))
})

test('missing edit.json → default edit, repaired false', async () => {
  const r = await loadEdit(dir, manifest(4000), noProbe)
  expect(r.repaired).toBe(false)
  expect(r.sourceMs).toBe(4000)
  expect(r.edit.clips.map((c) => [c.srcStartMs, c.srcEndMs])).toEqual([[0, 4000]])
  // Default camera from the Plan A bubble placement: bottom-left, 20 % of width.
  expect(r.edit.camera).toEqual({ visible: true, x: 24, y: 720 - 24 - 256, size: 256 })
})

test('corrupt edit.json → default edit, repaired true', async () => {
  writeFileSync(join(dir, 'edit.json'), '{nope')
  const r = await loadEdit(dir, manifest(4000), noProbe)
  expect(r.repaired).toBe(true)
  expect(r.edit.clips).toHaveLength(1)
})

test('durationMs 0 (recovered recording) uses the probe', async () => {
  const r = await loadEdit(dir, manifest(0), async () => 3210)
  expect(r.sourceMs).toBe(3210)
  expect(r.edit.clips[0].srcEndMs).toBe(3210)
})

test('save then load round-trips', async () => {
  const first = await loadEdit(dir, manifest(4000), noProbe)
  const edited = { ...first.edit, gains: { mic: 2, system: 0.5 } }
  await saveEdit(dir, edited)
  const again = await loadEdit(dir, manifest(4000), noProbe)
  expect(again.edit).toEqual(edited)
  expect(again.repaired).toBe(false)
  expect(existsSync(join(dir, 'edit.json.tmp'))).toBe(false)
})

test('writeOverlayPng creates overlays/<id>.png', async () => {
  const path = await writeOverlayPng(dir, 'abc', new Uint8Array([137, 80, 78, 71]))
  expect(path).toBe(join(dir, 'overlays', 'abc.png'))
  expect([...readFileSync(path)]).toEqual([137, 80, 78, 71])
})

test('writeOverlayPng rejects ids that would escape the folder', async () => {
  await expect(writeOverlayPng(dir, '..\\evil', new Uint8Array([1]))).rejects.toThrow(/overlay id/i)
})
