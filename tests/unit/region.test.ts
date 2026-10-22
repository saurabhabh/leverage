import { test, expect } from 'vitest'
import { dipRectToVideoRect, normalizeDrag } from '../../src/shared/region'

test('150% display: DIP rect maps to video pixels with even width/height', () => {
  // A 1280×720 DIP display captured at 1920×1080 (scale 1.5).
  expect(
    dipRectToVideoRect(
      { x: 100, y: 100, width: 201, height: 101 },
      { x: 0, y: 0, width: 1280, height: 720 },
      { width: 1920, height: 1080 }
    )
  ).toEqual({ x: 150, y: 150, width: 300, height: 150 })
})

test('second monitor: the display origin is subtracted', () => {
  expect(
    dipRectToVideoRect(
      { x: 1920 + 10, y: 20, width: 100, height: 50 },
      { x: 1920, y: 0, width: 1920, height: 1080 },
      { width: 1920, height: 1080 }
    )
  ).toEqual({ x: 10, y: 20, width: 100, height: 50 })
})

test('clamps a rect overflowing the right and bottom edges', () => {
  expect(
    dipRectToVideoRect(
      { x: 1800, y: 1000, width: 400, height: 400 },
      { x: 0, y: 0, width: 1920, height: 1080 },
      { width: 1920, height: 1080 }
    )
  ).toEqual({ x: 1800, y: 1000, width: 120, height: 80 })
})

test('clamps a rect starting left of the display', () => {
  expect(
    dipRectToVideoRect(
      { x: -50, y: 0, width: 150, height: 100 },
      { x: 0, y: 0, width: 1920, height: 1080 },
      { width: 1920, height: 1080 }
    )
  ).toEqual({ x: 0, y: 0, width: 100, height: 100 })
})

test('never returns smaller than 2×2', () => {
  const r = dipRectToVideoRect(
    { x: 10, y: 10, width: 1, height: 1 },
    { x: 0, y: 0, width: 1920, height: 1080 },
    { width: 1920, height: 1080 }
  )
  expect(r.width).toBe(2)
  expect(r.height).toBe(2)
})

test('normalizeDrag handles dragging up-left', () => {
  expect(normalizeDrag({ x: 300, y: 200 }, { x: 100, y: 50 })).toEqual({ x: 100, y: 50, width: 200, height: 150 })
})
