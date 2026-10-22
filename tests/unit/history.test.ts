import { test, expect } from 'vitest'
import { History } from '../../src/shared/history'

test('undo/redo round-trips', () => {
  const h = new History('a')
  h.push('b')
  h.push('c')
  expect(h.undo()).toBe('b')
  expect(h.undo()).toBe('a')
  expect(h.canUndo).toBe(false)
  expect(h.redo()).toBe('b')
  expect(h.present).toBe('b')
})

test('push after undo clears redo', () => {
  const h = new History(1)
  h.push(2)
  h.undo()
  h.push(3)
  expect(h.canRedo).toBe(false)
  expect(h.present).toBe(3)
})

test('pushing the same reference is a no-op', () => {
  const s = { v: 1 }
  const h = new History(s)
  h.push(s)
  expect(h.canUndo).toBe(false)
})

test('limit drops oldest', () => {
  const h = new History(0, 3)
  for (let i = 1; i <= 5; i++) h.push(i)
  let n = 0
  while (h.canUndo) {
    h.undo()
    n++
  }
  expect(n).toBe(3)
  expect(h.present).toBe(2)
})
