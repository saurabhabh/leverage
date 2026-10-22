import { describe, test, expect } from 'vitest'
import { handleAt, nudge, resizeBy } from '../../src/shared/selection'

const r = { x: 100, y: 100, width: 200, height: 100 }
const bounds = { width: 1000, height: 800 }

describe('handleAt', () => {
  test('corners, edges, inside and outside', () => {
    expect(handleAt(r, { x: 101, y: 99 }, 8)).toBe('nw')
    expect(handleAt(r, { x: 300, y: 200 }, 8)).toBe('se')
    expect(handleAt(r, { x: 200, y: 103 }, 8)).toBe('n')
    expect(handleAt(r, { x: 296, y: 150 }, 8)).toBe('e')
    expect(handleAt(r, { x: 200, y: 150 }, 8)).toBe('move')
    expect(handleAt(r, { x: 50, y: 50 }, 8)).toBeNull()
  })
  test('a tiny selection is still movable from its middle', () => {
    expect(handleAt({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5 }, 8)).toBe('move')
  })
})

describe('resizeBy', () => {
  test('dragging an edge moves only that edge', () => {
    expect(resizeBy(r, 'e', 50, 30, bounds)).toEqual({ x: 100, y: 100, width: 250, height: 100 })
    expect(resizeBy(r, 'nw', -10, -20, bounds)).toEqual({ x: 90, y: 80, width: 210, height: 120 })
  })
  test('dragging past the opposite edge flips instead of going negative', () => {
    expect(resizeBy(r, 'w', 250, 0, bounds)).toEqual({ x: 300, y: 100, width: 50, height: 100 })
  })
  test('move keeps the size and stays on the display', () => {
    expect(resizeBy(r, 'move', 900, -500, bounds)).toEqual({
      x: 800,
      y: 0,
      width: 200,
      height: 100
    })
  })
  test('edges are clamped to the display', () => {
    expect(resizeBy(r, 'se', 5000, 5000, bounds)).toEqual({
      x: 100,
      y: 100,
      width: 900,
      height: 700
    })
  })
})

describe('nudge', () => {
  test('arrows move by 1, Shift by 10, clamped', () => {
    expect(nudge(r, 'ArrowLeft', { shift: false, ctrl: false }, bounds)).toMatchObject({
      x: 99,
      width: 200
    })
    expect(nudge(r, 'ArrowDown', { shift: true, ctrl: false }, bounds)).toMatchObject({
      y: 110,
      height: 100
    })
    expect(nudge({ ...r, x: 0 }, 'ArrowLeft', { shift: false, ctrl: false }, bounds)).toMatchObject(
      { x: 0 }
    )
  })
  test('Ctrl+arrows resize from the right/bottom edge, never below 1 px', () => {
    expect(nudge(r, 'ArrowRight', { shift: false, ctrl: true }, bounds)).toEqual({
      ...r,
      width: 201
    })
    expect(nudge(r, 'ArrowUp', { shift: true, ctrl: true }, bounds)).toEqual({ ...r, height: 90 })
    expect(
      nudge({ ...r, width: 1 }, 'ArrowLeft', { shift: false, ctrl: true }, bounds)
    ).toMatchObject({ width: 1 })
  })
})
