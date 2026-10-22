import { describe, test, expect } from 'vitest'
import { dipToImageRect, matchSources } from '../../src/main/snap/capture'
import { registerOne } from '../../src/main/hotkeys'

describe('dipToImageRect', () => {
  test('1× display at the origin maps one to one', () => {
    const r = dipToImageRect(
      { x: 10, y: 20, width: 30, height: 40 },
      { x: 0, y: 0, width: 1920, height: 1080 },
      { width: 1920, height: 1080 }
    )
    expect(r).toEqual({ x: 10, y: 20, width: 30, height: 40 })
  })

  test('150 % scaling: DIP are multiplied, covering every touched pixel', () => {
    const bounds = { x: 0, y: 0, width: 1280, height: 720 }
    const image = { width: 1920, height: 1080 }
    expect(dipToImageRect({ x: 10, y: 10, width: 101, height: 51 }, bounds, image)).toEqual({
      x: 15,
      y: 15,
      width: 152,
      height: 77
    })
  })

  test('second display to the left (negative origin) uses display-relative coordinates', () => {
    const bounds = { x: -1920, y: 0, width: 1920, height: 1080 }
    expect(
      dipToImageRect({ x: -1900, y: 5, width: 100, height: 100 }, bounds, {
        width: 1920,
        height: 1080
      })
    ).toEqual({
      x: 20,
      y: 5,
      width: 100,
      height: 100
    })
  })

  test('clamped to the image and never empty', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 }
    expect(
      dipToImageRect({ x: 90, y: -10, width: 50, height: 20 }, bounds, { width: 100, height: 100 })
    ).toEqual({ x: 90, y: 0, width: 10, height: 10 })
    expect(
      dipToImageRect({ x: 150, y: 150, width: 5, height: 5 }, bounds, { width: 100, height: 100 })
        .width
    ).toBeGreaterThanOrEqual(1)
  })
})

describe('matchSources', () => {
  const displays = [{ id: 1 }, { id: 2 }]
  test('by display_id', () => {
    const sources = [
      { display_id: '2', name: 'b' },
      { display_id: '1', name: 'a' }
    ]
    expect(matchSources(displays, sources).map((s) => s?.name)).toEqual(['a', 'b'])
  })
  test('falls back to order when ids are missing (Linux) and counts match', () => {
    const sources = [
      { display_id: '', name: 'a' },
      { display_id: '', name: 'b' }
    ]
    expect(matchSources(displays, sources).map((s) => s?.name)).toEqual(['a', 'b'])
  })
  test('unmatched displays get null', () => {
    expect(matchSources(displays, [{ display_id: '9', name: 'z' }])).toEqual([null, null])
  })
})

test('registerOne reports failure when register returns false or throws', () => {
  expect(
    registerOne(
      'A',
      () => {},
      () => true
    )
  ).toBe(true)
  expect(
    registerOne(
      'A',
      () => {},
      () => false
    )
  ).toBe(false)
  expect(
    registerOne(
      'A',
      () => {},
      () => {
        throw new Error('bad')
      }
    )
  ).toBe(false)
})
