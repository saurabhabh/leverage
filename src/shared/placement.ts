import type { Rect } from './types'

export const BUBBLE_SIZES = { S: 150, M: 200, L: 280 } as const
export type BubbleSize = keyof typeof BUBBLE_SIZES
const BUBBLE_MARGIN = 24
const TOOLBAR = { width: 300, height: 56, margin: 24 }

/** Loom-style default: bottom-left corner of the recorded display (work area, DIP). */
export function bubbleDefaultBounds(display: Rect, size: number = BUBBLE_SIZES.M): Rect {
  return {
    x: display.x + BUBBLE_MARGIN,
    y: display.y + display.height - BUBBLE_MARGIN - size,
    width: size,
    height: size
  }
}

/** Bubble bounds as stored in the manifest: DIP relative to the recorded display's origin. */
export function bubbleRelativeTo(bounds: Rect, display: Rect): { xDip: number; yDip: number; sizeDip: number } {
  return { xDip: bounds.x - display.x, yDip: bounds.y - display.y, sizeDip: bounds.width }
}

export function toolbarBounds(display: Rect): Rect {
  return {
    x: display.x + Math.round((display.width - TOOLBAR.width) / 2),
    y: display.y + display.height - TOOLBAR.height - TOOLBAR.margin,
    width: TOOLBAR.width,
    height: TOOLBAR.height
  }
}
