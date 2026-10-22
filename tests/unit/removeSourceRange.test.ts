import { test, expect } from 'vitest'
import { cutRange, removeSourceRange, type EditDoc } from '../../src/shared/edit'

const doc = (clips: [number, number][]): EditDoc => ({
  version: 1,
  clips: clips.map(([s, e], i) => ({ id: `c${i}`, srcStartMs: s, srcEndMs: e })),
  overlays: [],
  camera: null,
  gains: { mic: 1, system: 1 },
  muted: { mic: false, system: false }
})
const spans = (e: EditDoc): [number, number][] => e.clips.map((c) => [c.srcStartMs, c.srcEndMs])

test('removeSourceRange inside one clip splits it', () => {
  expect(spans(removeSourceRange(doc([[0, 10_000]]), 2000, 3000))).toEqual([[0, 2000], [3000, 10_000]])
})

test('spanning two clips trims both', () => {
  expect(spans(removeSourceRange(doc([[0, 4000], [6000, 10_000]]), 3000, 7000))).toEqual([[0, 3000], [7000, 10_000]])
})

test('with reordered clips removes the same content wherever it plays', () => {
  expect(spans(removeSourceRange(doc([[5000, 8000], [0, 3000]]), 1000, 6000))).toEqual([[6000, 8000], [0, 1000]])
})

test('a range already cut changes nothing', () => {
  const e = doc([[0, 2000], [5000, 8000]])
  expect(removeSourceRange(e, 2500, 4500)).toBe(e)
})

test('removing everything is a no-op', () => {
  const e = doc([[0, 2000], [5000, 8000]])
  expect(removeSourceRange(e, 0, 10_000)).toBe(e)
})

test('pieces shorter than 100 ms are dropped', () => {
  expect(spans(removeSourceRange(doc([[0, 10_000]]), 50, 5000))).toEqual([[5000, 10_000]])
})

test('matches cutRange when the edit is unreordered', () => {
  const e = doc([[0, 10_000]])
  expect(spans(removeSourceRange(e, 2000, 3000))).toEqual(spans(cutRange(e, 2000, 3000)))
})
