import { BrowserWindow } from 'electron'
import type { BubblePlacement } from '../../shared/ipc'
import { BUBBLE_SIZES, bubbleDefaultBounds, bubbleRelativeTo, type BubbleSize } from '../../shared/placement'
import type { Rect } from '../../shared/types'
import { helperWebPreferences, loadPage } from './load'

let bubble: BrowserWindow | null = null
let shownFor: { cameraId: string; display: Rect } | null = null

/**
 * Loom-style circular camera preview. It is content-protected, so it never lands in the screen
 * track; the camera is recorded separately and composited at export where the bubble was.
 */
export function showBubble(cameraId: string, display: Rect, workArea: Rect): void {
  if (bubble && !bubble.isDestroyed() && shownFor?.cameraId === cameraId) return
  hideBubble()
  shownFor = { cameraId, display }
  bubble = new BrowserWindow({
    ...bubbleDefaultBounds(workArea),
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: helperWebPreferences()
  })
  bubble.setAlwaysOnTop(true, 'screen-saver')
  bubble.setContentProtection(true)
  bubble.once('ready-to-show', () => bubble?.showInactive())
  bubble.on('closed', () => {
    bubble = null
  })
  void loadPage(bubble, 'bubble.html', { cameraId })
}

export function resizeBubble(size: BubbleSize): void {
  if (!bubble || bubble.isDestroyed()) return
  const old = bubble.getBounds()
  const px = BUBBLE_SIZES[size]
  // Keep the bottom-left corner fixed so the bubble grows away from the screen corner.
  bubble.setBounds({ x: old.x, y: old.y + old.height - px, width: px, height: px })
}

/** Bubble position relative to the recorded display, or null when no bubble is showing. */
export function bubblePlacement(): BubblePlacement | null {
  if (!bubble || bubble.isDestroyed() || !shownFor) return null
  return bubbleRelativeTo(bubble.getBounds(), shownFor.display)
}

export function hideBubble(): void {
  if (bubble && !bubble.isDestroyed()) bubble.close()
  bubble = null
  shownFor = null
}
