import { test, expect } from 'vitest'
import { SnapDocSchema, type SnapDoc } from '../../src/shared/snap'

const doc: SnapDoc = {
  version: 1,
  id: '2026-10-22_14-05-09',
  file: '2026-10-22_14-05-09.png',
  createdAt: '2026-10-22T14:05:09.000Z',
  width: 800,
  height: 600,
  shapes: [
    { id: 'a', kind: 'arrow', color: '#ff0000', size: 3, a: { x: 1, y: 2 }, b: { x: 30, y: 40 } },
    {
      id: 'b',
      kind: 'rect',
      color: '#ff0000',
      size: 3,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      filled: true
    },
    {
      id: 'c',
      kind: 'pen',
      color: '#00ff00',
      size: 2,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 }
      ]
    },
    {
      id: 'd',
      kind: 'text',
      color: '#000000',
      size: 20,
      at: { x: 5, y: 5 },
      text: 'Hi',
      bold: true
    },
    { id: 'e', kind: 'counter', color: '#ff0000', size: 3, at: { x: 50, y: 50 } },
    {
      id: 'f',
      kind: 'pixelate',
      color: '#000000',
      size: 10,
      rect: { x: 0, y: 0, width: 50, height: 20 }
    }
  ]
}

test('a valid doc parses unchanged', () => {
  expect(SnapDocSchema.parse(doc)).toEqual(doc)
})

test('crop is optional and kept when present', () => {
  const cropped = { ...doc, crop: { x: 10, y: 10, width: 100, height: 50 } }
  expect(SnapDocSchema.parse(cropped).crop).toEqual(cropped.crop)
})

test('unknown shape kinds and wrong versions are rejected', () => {
  expect(
    SnapDocSchema.safeParse({
      ...doc,
      shapes: [{ id: 'x', kind: 'laser', color: '#f00', size: 1 }]
    }).success
  ).toBe(false)
  expect(SnapDocSchema.safeParse({ ...doc, version: 2 }).success).toBe(false)
})
