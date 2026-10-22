import { test, expect } from 'vitest'
import { bubbleDefaultBounds, bubbleRelativeTo, toolbarBounds, BUBBLE_SIZES } from '../../src/shared/placement'

const display = { x: 1920, y: 0, width: 1920, height: 1040 }

test('bubble defaults to bottom-left of the recorded display with a 24 DIP margin', () => {
  expect(bubbleDefaultBounds(display)).toEqual({ x: 1920 + 24, y: 1040 - 24 - 200, width: 200, height: 200 })
})

test('bubble sizes are S/M/L = 150/200/280', () => {
  expect(BUBBLE_SIZES).toEqual({ S: 150, M: 200, L: 280 })
})

test('bubble position is stored relative to the display origin', () => {
  expect(bubbleRelativeTo({ x: 2000, y: 700, width: 280, height: 280 }, display)).toEqual({
    xDip: 80,
    yDip: 700,
    sizeDip: 280
  })
})

test('toolbar sits bottom-centre, 300×56, above the bottom edge', () => {
  expect(toolbarBounds(display)).toEqual({ x: 1920 + 810, y: 1040 - 56 - 24, width: 300, height: 56 })
})
