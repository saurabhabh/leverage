import type { RecordingManifest, Size } from '../../shared/types'

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)
const DEFAULT_BUBBLE_FRACTION = 0.2
const DEFAULT_BUBBLE_MARGIN = 24

/** Size of the exported frame: the crop if any, else the captured video; always even. */
export function frameSize(m: RecordingManifest): Size {
  const s = m.crop ?? m.videoSize
  return { width: even(s.width), height: even(s.height) }
}

export function cropFilter(m: RecordingManifest): string {
  const c = m.crop
  return c ? `crop=${c.width}:${c.height}:${c.x}:${c.y},` : ''
}

/**
 * Where the camera circle goes in the exported frame (pixels): the recorded bubble position
 * mapped from DIP to video pixels and shifted by the crop, clamped inside the frame.
 * Without a recorded bubble (or for window capture) it defaults to bottom-left.
 */
export function bubbleOverlayBox(m: RecordingManifest, frame: Size): { x: number; y: number; size: number } {
  const bounds = m.source.displayBoundsDip
  const maxSize = even(Math.min(frame.width, frame.height))
  if (m.bubble && bounds) {
    const scale = m.videoSize.width / bounds.width
    const size = Math.min(even(Math.round(m.bubble.sizeDip * scale)), maxSize)
    const x = Math.round(m.bubble.xDip * scale - (m.crop?.x ?? 0))
    const y = Math.round(m.bubble.yDip * scale - (m.crop?.y ?? 0))
    return {
      x: Math.min(Math.max(0, x), frame.width - size),
      y: Math.min(Math.max(0, y), frame.height - size),
      size
    }
  }
  const size = Math.min(even(Math.round(frame.width * DEFAULT_BUBBLE_FRACTION)), maxSize)
  return {
    x: Math.min(DEFAULT_BUBBLE_MARGIN, frame.width - size),
    y: Math.max(0, frame.height - DEFAULT_BUBBLE_MARGIN - size),
    size
  }
}

/** `-progress pipe:1` reports out_time_ms (in microseconds, despite the name). */
export function parseFfmpegProgress(line: string, totalMs: number): number | null {
  const match = /^out_time_ms=(\d+)$/.exec(line.trim())
  if (!match || totalMs <= 0) return null
  return Math.min(100, Math.round((Number(match[1]) / 1000 / totalMs) * 100))
}
