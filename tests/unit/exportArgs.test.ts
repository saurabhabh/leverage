import { describe, test, expect } from 'vitest'
import { join } from 'path'
import { bubbleOverlayBox, parseFfmpegProgress } from '../../src/main/media/exportArgs'
import type { RecordingManifest } from '../../src/shared/types'

const DIR = 'D:\\lib\\rec'

function manifest(patch: Partial<RecordingManifest> = {}): RecordingManifest {
  return {
    version: 1,
    id: 'r1',
    title: 'Recording',
    createdAt: '2026-10-22T10:00:00.000Z',
    status: 'complete',
    durationMs: 10_000,
    source: { kind: 'screen', name: 'Screen 1', scaleFactor: 1.5, displayBoundsDip: { x: 0, y: 0, width: 1280, height: 720 } },
    videoSize: { width: 1920, height: 1080 },
    tracks: { screen: { file: 'screen.webm', mime: 'video/webm;codecs=vp9', offsetMs: 0 } },
    disabledTracks: {},
    ...patch
  }
}

const track = (file: string, offsetMs = 0): { file: string; mime: string; offsetMs: number } => ({
  file,
  mime: 'x',
  offsetMs
})
const filterOf = (args: string[]): string => args[args.indexOf('-filter_complex') + 1]
const inputs = (args: string[]): string[] => args.filter((_, i) => args[i - 1] === '-i')
const opts = { micGain: 1, systemGain: 1, includeCamera: true }

describe('bubbleOverlayBox', () => {
  const frame = { width: 1920, height: 1080 }

  test('bubble partly off-frame is clamped inside the frame', () => {
    const box = bubbleOverlayBox(
      manifest({ bubble: { xDip: 1200, yDip: 650, sizeDip: 200 } }),
      frame
    )
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.size).toBeLessThanOrEqual(1920)
    expect(box.y + box.size).toBeLessThanOrEqual(1080)
  })

  test('bubble position is shifted by the crop origin', () => {
    const m = manifest({ crop: { x: 300, y: 150, width: 1200, height: 800 }, bubble: { xDip: 400, yDip: 200, sizeDip: 100 } })
    expect(bubbleOverlayBox(m, { width: 1200, height: 800 })).toEqual({ x: 300, y: 150, size: 150 })
  })

  test('no bubble recorded → bottom-left, 20 % of width, 24 px margin', () => {
    expect(bubbleOverlayBox(manifest(), frame)).toEqual({ x: 24, y: 1080 - 24 - 384, size: 384 })
  })

  test('window capture (no display bounds) uses the default placement', () => {
    const m = manifest({ source: { kind: 'window', name: 'Notepad', scaleFactor: 1 }, bubble: { xDip: 5, yDip: 5, sizeDip: 200 } })
    expect(bubbleOverlayBox(m, frame).x).toBe(24)
  })
})

describe('parseFfmpegProgress', () => {
  test('out_time_ms (microseconds) → percent of total', () => {
    expect(parseFfmpegProgress('out_time_ms=5000000', 10_000)).toBe(50)
  })
  test('clamps to 100 and ignores other lines', () => {
    expect(parseFfmpegProgress('out_time_ms=99000000', 10_000)).toBe(100)
    expect(parseFfmpegProgress('frame=12', 10_000)).toBeNull()
    expect(parseFfmpegProgress('out_time_ms=N/A', 10_000)).toBeNull()
  })
})
