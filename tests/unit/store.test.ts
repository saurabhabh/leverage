import { describe, test, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RecordingStore, type CreateInit } from '../../src/main/recording/store'

let root: string
let remuxed: string[]
const remux = async (inFile: string, outFile: string): Promise<void> => {
  remuxed.push(inFile)
  copyFileSync(inFile, outFile)
}

const init: CreateInit = {
  source: {
    kind: 'screen',
    name: 'Screen 1',
    scaleFactor: 1,
    displayBoundsDip: { x: 0, y: 0, width: 1920, height: 1080 }
  },
  videoSize: { width: 1920, height: 1080 },
  tracks: ['screen', 'mic'],
  mimes: { screen: 'video/webm;codecs=vp9', mic: 'audio/webm;codecs=opus' }
}

type M = {
  id: string
  version: number
  status: string
  tracks: Record<string, { file: string; mime: string; offsetMs: number }>
  disabledTracks: Record<string, string>
}
const manifestOf = (dir: string): M => JSON.parse(readFileSync(join(dir, 'recording.json'), 'utf8'))

beforeEach(() => {
  root = join(mkdtempSync(join(tmpdir(), 'lev-store-')), 'Library')
  remuxed = []
})

describe('RecordingStore', () => {
  test('create makes root if missing and writes manifest with status "recording"', async () => {
    const store = new RecordingStore(root, remux)
    const { id, dir } = await store.create(init)
    expect(existsSync(root)).toBe(true)
    const m = manifestOf(dir)
    expect(m.status).toBe('recording')
    expect(m.id).toBe(id)
    expect(m.version).toBe(1)
    expect(m.tracks).toEqual({
      screen: { file: 'screen.webm', mime: 'video/webm;codecs=vp9', offsetMs: 0 },
      mic: { file: 'mic.webm', mime: 'audio/webm;codecs=opus', offsetMs: 0 }
    })
  })

  test('two recordings created in the same second get different folders', async () => {
    const store = new RecordingStore(root, remux, () => new Date(2026, 9, 22, 10, 0, 0))
    const a = await store.create(init)
    const b = await store.create(init)
    expect(a.dir).not.toBe(b.dir)
    expect(b.dir.endsWith('2026-10-22 10-00-00 (2)')).toBe(true)
  })

  test('appendChunk appends bytes in order', async () => {
    const store = new RecordingStore(root, remux)
    const { id, dir } = await store.create(init)
    await Promise.all([
      store.appendChunk(id, 'screen', new Uint8Array([1, 2])),
      store.appendChunk(id, 'screen', new Uint8Array([3]))
    ])
    expect([...readFileSync(join(dir, 'screen.webm'))]).toEqual([1, 2, 3])
  })

  test('setTrackOffset and disableTrack are persisted', async () => {
    const store = new RecordingStore(root, remux)
    const { id, dir } = await store.create(init)
    await store.setTrackOffset(id, 'mic', 120)
    await store.disableTrack(id, 'camera', 'Camera permission denied')
    const m = manifestOf(dir)
    expect(m.tracks.mic.offsetMs).toBe(120)
    expect(m.disabledTracks.camera).toBe('Camera permission denied')
  })

  test('a disabled track with no data is dropped from tracks on finalize', async () => {
    const store = new RecordingStore(root, remux)
    const { id, dir } = await store.create(init)
    await store.appendChunk(id, 'screen', new Uint8Array([1]))
    await store.disableTrack(id, 'mic', 'Microphone disconnected')
    await store.finalize(id, 1000)
    const m = manifestOf(dir)
    expect(m.tracks.mic).toBeUndefined()
    expect(m.disabledTracks.mic).toBe('Microphone disconnected')
  })

  test('finalize remuxes tracks with data, sets status complete and duration', async () => {
    const store = new RecordingStore(root, remux)
    const { id, dir } = await store.create(init)
    await store.appendChunk(id, 'screen', new Uint8Array([9]))
    await store.appendChunk(id, 'mic', new Uint8Array([8]))
    const m = await store.finalize(id, 4200)
    expect(m.status).toBe('complete')
    expect(m.durationMs).toBe(4200)
    expect(remuxed.sort()).toEqual([join(dir, 'mic.webm'), join(dir, 'screen.webm')].sort())
    expect([...readFileSync(join(dir, 'screen.webm'))]).toEqual([9])
    expect(existsSync(join(dir, 'screen.fixed.webm'))).toBe(false)
  })

  test('finalize keeps the raw file when remux fails', async () => {
    const store = new RecordingStore(root, async () => {
      throw new Error('ffmpeg broke')
    })
    const { id, dir } = await store.create(init)
    await store.appendChunk(id, 'screen', new Uint8Array([7]))
    const m = await store.finalize(id, 1000)
    expect(m.status).toBe('complete')
    expect([...readFileSync(join(dir, 'screen.webm'))]).toEqual([7])
  })

  test('abort deletes only that recording folder', async () => {
    const store = new RecordingStore(root, remux)
    const keep = await store.create(init)
    const gone = await store.create(init)
    await store.abort(gone.id)
    expect(existsSync(gone.dir)).toBe(false)
    expect(existsSync(keep.dir)).toBe(true)
  })

  test('recover marks status "recording" manifests as "incomplete" and keeps their files', async () => {
    const crashed = new RecordingStore(root, remux)
    const { id, dir } = await crashed.create(init)
    await crashed.appendChunk(id, 'screen', new Uint8Array([5, 5]))
    const fresh = new RecordingStore(root, remux)
    expect(await fresh.recover()).toEqual([id])
    expect(manifestOf(dir).status).toBe('incomplete')
    expect([...readFileSync(join(dir, 'screen.webm'))]).toEqual([5, 5])
  })

  test('list returns newest first and skips folders without a valid recording.json', async () => {
    let t = 0
    const store = new RecordingStore(root, remux, () => new Date(2026, 0, 1, 0, 0, t++))
    const a = await store.create(init)
    const b = await store.create(init)
    mkdirSync(join(root, 'random folder'))
    mkdirSync(join(root, 'broken'))
    writeFileSync(join(root, 'broken', 'recording.json'), '{oops')
    const ids = (await store.list()).map((m) => m.id)
    expect(ids).toEqual([b.id, a.id])
  })

  test('list on a missing library folder returns empty', async () => {
    expect(await new RecordingStore(join(root, 'nope'), remux).list()).toEqual([])
  })

  test('appendChunk throws for an unknown id', async () => {
    const store = new RecordingStore(root, remux)
    await expect(store.appendChunk('missing', 'screen', new Uint8Array([1]))).rejects.toThrow(
      /Unknown recording/
    )
  })
})
