import { describe, test, expect } from 'vitest'
import {
  arrowGeometry,
  counterNumbers,
  hitTest,
  moveShape,
  shapeBounds,
  snapAngle
} from '../../src/renderer/src/snap/geometry'
import { UndoStack } from '../../src/renderer/src/snap/undo'
import type { Shape } from '../../src/shared/snap'

const red = { color: '#ff0000' }

describe('snapAngle', () => {
  test('keeps length and moves to the nearest 45° direction', () => {
    const b = snapAngle({ x: 0, y: 0 }, { x: 100, y: 10 })
    expect(b.x).toBeCloseTo(Math.hypot(100, 10))
    expect(b.y).toBeCloseTo(0)
    const d = snapAngle({ x: 10, y: 10 }, { x: 60, y: 55 })
    expect(d.x - 10).toBeCloseTo(d.y - 10)
  })
  test('zero-length drag stays put', () => {
    expect(snapAngle({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 })
  })
})

describe('arrowGeometry', () => {
  test('tip is the end point and the shaft stops inside the head', () => {
    const g = arrowGeometry({ x: 0, y: 0 }, { x: 200, y: 0 }, 3)
    expect(g.head[0]).toEqual({ x: 200, y: 0 })
    // Head length 18 + 4·3 = 30, width 10 + 2·3 = 16.
    expect(g.head[1].x).toBeCloseTo(170)
    expect(Math.abs(g.head[1].y - g.head[2].y)).toBeCloseTo(16)
    expect(g.shaftEnd.x).toBeGreaterThan(170)
    expect(g.shaftEnd.x).toBeLessThan(200)
  })
  test('a short arrow shrinks its head to 60 % of the length', () => {
    const g = arrowGeometry({ x: 0, y: 0 }, { x: 20, y: 0 }, 3)
    expect(g.head[1].x).toBeCloseTo(8)
  })
})

describe('bounds, hit-testing, moving', () => {
  const line: Shape = {
    id: 'l',
    kind: 'line',
    ...red,
    size: 4,
    a: { x: 0, y: 0 },
    b: { x: 100, y: 100 }
  }
  const box: Shape = {
    id: 'r',
    kind: 'rect',
    ...red,
    size: 2,
    rect: { x: 200, y: 200, width: -50, height: 40 },
    filled: false
  }
  const text: Shape = {
    id: 't',
    kind: 'text',
    ...red,
    size: 20,
    at: { x: 10, y: 300 },
    text: 'Hello',
    bold: false
  }

  test('rect bounds are normalised (negative width) and padded by half the stroke', () => {
    expect(shapeBounds(box)).toEqual({ x: 149, y: 199, width: 52, height: 42 })
  })

  test('text bounds use the measure function', () => {
    expect(shapeBounds(text, (t, px) => ({ width: t.length * px, height: px }))).toEqual({
      x: 10,
      y: 300,
      width: 100,
      height: 20
    })
  })

  test('hitTest returns the topmost shape near the point, or null', () => {
    const shapes = [line, box]
    expect(hitTest(shapes, { x: 50, y: 52 }, 3)).toBe('l')
    expect(hitTest(shapes, { x: 50, y: 70 }, 3)).toBeNull()
    expect(hitTest(shapes, { x: 170, y: 220 }, 3)).toBe('r')
    const covering: Shape = {
      id: 'top',
      kind: 'redact',
      ...red,
      size: 1,
      rect: { x: 0, y: 0, width: 500, height: 500 }
    }
    expect(hitTest([...shapes, covering], { x: 50, y: 50 }, 3)).toBe('top')
  })

  test('moveShape moves every point', () => {
    expect(moveShape(line, 5, -5)).toMatchObject({ a: { x: 5, y: -5 }, b: { x: 105, y: 95 } })
    expect(moveShape(box, 1, 1)).toMatchObject({ rect: { x: 201, y: 201 } })
    const pen: Shape = {
      id: 'p',
      kind: 'pen',
      ...red,
      size: 2,
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 3 }
      ]
    }
    expect(moveShape(pen, 1, 1)).toMatchObject({
      points: [
        { x: 2, y: 2 },
        { x: 3, y: 4 }
      ]
    })
  })

  test('counters are numbered in drawing order and renumber when one is removed', () => {
    const c = (id: string): Shape => ({ id, kind: 'counter', ...red, size: 3, at: { x: 0, y: 0 } })
    const shapes = [c('a'), line, c('b'), c('c')]
    expect([...counterNumbers(shapes)]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3]
    ])
    expect([...counterNumbers(shapes.filter((s) => s.id !== 'a'))]).toEqual([
      ['b', 1],
      ['c', 2]
    ])
  })
})

describe('UndoStack', () => {
  test('undo/redo walk the history; a new push clears redo', () => {
    const s = new UndoStack<number>(0)
    s.push(1)
    s.push(2)
    expect(s.undo()).toBe(1)
    expect(s.undo()).toBe(0)
    expect(s.canUndo).toBe(false)
    expect(s.undo()).toBe(0)
    expect(s.redo()).toBe(1)
    s.push(5)
    expect(s.canRedo).toBe(false)
    expect(s.current).toBe(5)
  })
  test('keeps at most `limit` undo steps', () => {
    const s = new UndoStack<number>(0, 3)
    for (let i = 1; i <= 10; i++) s.push(i)
    s.undo()
    s.undo()
    s.undo()
    expect(s.canUndo).toBe(false)
    expect(s.current).toBe(7)
  })
})
