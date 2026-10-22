import { test, expect } from 'vitest'
import { pseudoPixelate, type Pixels } from '../../src/renderer/src/snap/pixelate'

function image(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number]
): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y)
      data.set([r, g, b, 255], (y * width + x) * 4)
    }
  return { data, width, height }
}

const rect = { x: 10, y: 10, width: 40, height: 30 }
const inside = (x: number, y: number): boolean =>
  x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height

test('the result never depends on the pixels being hidden', () => {
  const background = (x: number, y: number): [number, number, number] => [
    (x * 7) % 256,
    (y * 5) % 256,
    128
  ]
  const a = image(80, 60, (x, y) => (inside(x, y) ? [0, 0, 0] : background(x, y)))
  const b = image(80, 60, (x, y) =>
    inside(x, y) ? [x * 3, 255 - y, (x * y) % 256] : background(x, y)
  )
  expect(pseudoPixelate(a, rect, 8).data).toEqual(pseudoPixelate(b, rect, 8).data)
})

test('the output is made of solid blocks of the given size', () => {
  const img = image(80, 60, (x, y) => [x * 3, y * 4, 50])
  const { data, rect: r } = pseudoPixelate(img, rect, 8)
  expect(r).toEqual(rect)
  const px = (x: number, y: number): string =>
    data.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 4).join()
  expect(px(0, 0)).toBe(px(7, 7))
  expect(px(8, 0)).toBe(px(15, 7))
  expect(data[3]).toBe(255)
})

test('it is deterministic, so re-rendering a shot gives the same pixels', () => {
  const img = image(80, 60, (x, y) => [x, y, 0])
  expect(pseudoPixelate(img, rect, 6).data).toEqual(pseudoPixelate(img, rect, 6).data)
})

test('rects past the image edge are clamped; the whole image still works (no fringe at all)', () => {
  const img = image(20, 20, () => [200, 10, 10])
  const partly = pseudoPixelate(img, { x: 15, y: -5, width: 20, height: 10 }, 4)
  expect(partly.rect).toEqual({ x: 15, y: 0, width: 5, height: 5 })
  expect(partly.data.length).toBe(5 * 5 * 4)
  const whole = pseudoPixelate(img, { x: 0, y: 0, width: 20, height: 20 }, 4)
  expect(whole.data.length).toBe(20 * 20 * 4)
  // With no outside pixels to sample it must not leak the inside: flat grey.
  expect([...whole.data.slice(0, 3)]).toEqual([128, 128, 128])
})

test('negative-size rects are normalised', () => {
  const img = image(80, 60, (x) => [x, 0, 0])
  expect(pseudoPixelate(img, { x: 50, y: 40, width: -40, height: -30 }, 8).rect).toEqual(rect)
})
