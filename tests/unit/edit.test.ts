import { describe, test, expect } from 'vitest'
import {
  cutRange,
  defaultEdit,
  deleteClip,
  moveClip,
  outputDurationMs,
  outputToSource,
  repairEdit,
  sourceDurationMs,
  sourceToOutput,
  splitAt,
  setGain,
  type EditDoc
} from '../../src/shared/edit'
import type { RecordingManifest } from '../../src/shared/types'

const doc = (clips: [number, number][]): EditDoc => ({
  version: 1,
  clips: clips.map(([s, e], i) => ({ id: `c${i}`, srcStartMs: s, srcEndMs: e })),
  overlays: [],
  camera: null,
  gains: { mic: 1, system: 1 },
  muted: { mic: false, system: false }
})
const spans = (e: EditDoc): [number, number][] => e.clips.map((c) => [c.srcStartMs, c.srcEndMs])

describe('timeline maths', () => {
  test('outputDurationMs sums clip lengths', () => {
    expect(outputDurationMs(doc([[0, 4000], [6000, 10000]]))).toBe(8000)
  })

  test('outputToSource maps across a reordered clip list', () => {
    expect(outputToSource(doc([[5000, 8000], [0, 2000]]), 3500)).toEqual({ clipIndex: 1, srcMs: 500 })
  })

  test('outputToSource clamps and returns the last clip end at the very end', () => {
    const e = doc([[5000, 8000], [0, 2000]])
    expect(outputToSource(e, -10)).toEqual({ clipIndex: 0, srcMs: 5000 })
    expect(outputToSource(e, 99_999)).toEqual({ clipIndex: 1, srcMs: 2000 })
  })

  test('sourceToOutput: range inside one clip → one interval', () => {
    expect(sourceToOutput(doc([[0, 10000]]), 2000, 3000)).toEqual([{ outStartMs: 2000, outEndMs: 3000 }])
  })

  test('sourceToOutput: range spanning a cut → two intervals', () => {
    expect(sourceToOutput(doc([[0, 3000], [5000, 10000]]), 2000, 6000)).toEqual([
      { outStartMs: 2000, outEndMs: 3000 },
      { outStartMs: 3000, outEndMs: 4000 }
    ])
  })

  test('sourceToOutput: fully cut → []', () => {
    expect(sourceToOutput(doc([[0, 3000], [5000, 10000]]), 3200, 4800)).toEqual([])
  })

  test('sourceToOutput after reorder follows the content', () => {
    expect(sourceToOutput(doc([[5000, 10000], [0, 3000]]), 1000, 2000)).toEqual([{ outStartMs: 6000, outEndMs: 7000 }])
  })
})

describe('edit operations', () => {
  test('splitAt in the middle creates two clips covering the same source', () => {
    const e = splitAt(doc([[0, 10000]]), 4000)
    expect(spans(e)).toEqual([[0, 4000], [4000, 10000]])
    expect(new Set(e.clips.map((c) => c.id)).size).toBe(2)
  })

  test('splitAt within 100 ms of an edge is a no-op', () => {
    const e = doc([[0, 4000], [4000, 10000]])
    expect(splitAt(e, 4050)).toBe(e)
    expect(splitAt(e, 50)).toBe(e)
  })

  test('deleteClip removes it and later clips shift earlier in output time', () => {
    const e = deleteClip(doc([[0, 4000], [4000, 10000]]), 'c0')
    expect(spans(e)).toEqual([[4000, 10000]])
    expect(outputToSource(e, 0).srcMs).toBe(4000)
  })

  test('deleteClip on the last remaining clip is a no-op', () => {
    const e = doc([[0, 10000]])
    expect(deleteClip(e, 'c0')).toBe(e)
  })

  test('cutRange across two clips trims both', () => {
    expect(spans(cutRange(doc([[0, 4000], [4000, 10000]]), 3000, 5000))).toEqual([[0, 3000], [5000, 10000]])
  })

  test('cutRange inside one clip splits it', () => {
    expect(spans(cutRange(doc([[0, 10000]]), 2000, 3000))).toEqual([[0, 2000], [3000, 10000]])
  })

  test('cutRange of the whole output is a no-op', () => {
    const e = doc([[0, 4000], [4000, 10000]])
    expect(cutRange(e, 0, 10000)).toBe(e)
  })

  test('cutRange never leaves a sliver shorter than 100 ms', () => {
    expect(spans(cutRange(doc([[0, 10000]]), 50, 5000))).toEqual([[5000, 10000]])
  })

  test('moveClip reorders', () => {
    expect(spans(moveClip(doc([[0, 1000], [1000, 2000], [2000, 3000]]), 'c2', 0))).toEqual([
      [2000, 3000],
      [0, 1000],
      [1000, 2000]
    ])
  })

  test('operations never mutate their input', () => {
    const e = doc([[0, 10000]])
    const copy = JSON.stringify(e)
    splitAt(e, 5000)
    cutRange(e, 1000, 2000)
    setGain(e, 'mic', 2)
    expect(JSON.stringify(e)).toBe(copy)
  })

  test('setGain clamps to 0–4', () => {
    expect(setGain(doc([[0, 1000]]), 'mic', 9).gains.mic).toBe(4)
    expect(setGain(doc([[0, 1000]]), 'system', -1).gains.system).toBe(0)
  })
})

describe('defaults and repair', () => {
  const m = {
    durationMs: 5000,
    tracks: {
      screen: { file: 'screen.webm', mime: 'x', offsetMs: 2000 },
      camera: { file: 'camera.webm', mime: 'x', offsetMs: 2100 }
    }
  } as unknown as RecordingManifest

  test('sourceDurationMs: all tracks stop together, so the source runs from the earliest start to the end', () => {
    // durationMs counts from the session start; the earliest track began 2000 ms in.
    expect(sourceDurationMs(m)).toBe(3000)
  })

  test('defaultEdit is one clip over the whole source, with the camera box', () => {
    const e = defaultEdit(m, 5100, { x: 10, y: 20, size: 200 })
    expect(spans(e)).toEqual([[0, 5100]])
    expect(e.camera).toEqual({ visible: true, x: 10, y: 20, size: 200 })
    expect(defaultEdit(m, 5100, null).camera).toBeNull()
  })

  test('repairEdit clamps out-of-range clips, drops zero-length ones', () => {
    const raw = { ...doc([[-500, 3000], [3000, 3050], [4000, 99999]]) }
    const fallback = doc([[0, 5000]])
    const { edit, repaired } = repairEdit(raw, 5000, fallback)
    expect(repaired).toBe(true)
    expect(spans(edit)).toEqual([[0, 3000], [4000, 5000]])
  })

  test('repairEdit drops overlays with end <= start', () => {
    const raw = {
      ...doc([[0, 5000]]),
      overlays: [{ id: 'o', kind: 'blur', srcStartMs: 300, srcEndMs: 300, rect: { x: 0, y: 0, width: 10, height: 10 }, strength: 10 }]
    }
    const { edit, repaired } = repairEdit(raw, 5000, doc([[0, 5000]]))
    expect(edit.overlays).toEqual([])
    expect(repaired).toBe(true)
  })

  test('repairEdit falls back on garbage and accepts a valid doc untouched', () => {
    const fallback = doc([[0, 5000]])
    expect(repairEdit('nonsense', 5000, fallback)).toEqual({ edit: fallback, repaired: true })
    expect(repairEdit(doc([[0, 2000]]), 5000, fallback).repaired).toBe(false)
  })
})
