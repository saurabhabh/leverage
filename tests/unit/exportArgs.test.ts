import { describe, test, expect } from 'vitest'
import { join } from 'path'
import { buildMp4Args, buildGifArgs, bubbleOverlayBox, parseFfmpegProgress } from '../../src/main/media/exportArgs'
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

describe('buildMp4Args', () => {
  test('screen-only manifest → single input, no audio, has -an and the H.264 settings', () => {
    const args = buildMp4Args(manifest(), DIR, 'out.mp4', opts)
    expect(inputs(args)).toEqual([join(DIR, 'screen.webm')])
    expect(args).toContain('-an')
    expect(filterOf(args)).not.toContain('amix')
    expect(args.join(' ')).toContain('-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p')
    expect(args.join(' ')).toContain('-movflags +faststart')
    expect(args).toContain('-n')
    expect(args.at(-1)).toBe('out.mp4')
  })

  test('crop {150,150,300,150} appears as crop=300:150:150:150', () => {
    const args = buildMp4Args(manifest({ crop: { x: 150, y: 150, width: 300, height: 150 } }), DIR, 'o.mp4', opts)
    expect(filterOf(args)).toContain('crop=300:150:150:150')
  })

  test('mic+system → amix=inputs=2:normalize=0 with volume per input, AAC 192k', () => {
    const args = buildMp4Args(
      manifest({ tracks: { screen: track('screen.webm'), mic: track('mic.webm'), system: track('system.webm') } }),
      DIR,
      'o.mp4',
      { ...opts, micGain: 1.5, systemGain: 0.5 }
    )
    const f = filterOf(args)
    expect(f).toContain('[1:a]volume=1.5')
    expect(f).toContain('[2:a]volume=0.5')
    expect(f).toContain('amix=inputs=2:normalize=0')
    expect(args.join(' ')).toContain('-c:a aac -b:a 192k')
    expect(args).not.toContain('-an')
  })

  test('track offsets are relative to the earliest track: camera 120 ms after screen → -itsoffset 0.12', () => {
    const args = buildMp4Args(
      manifest({ tracks: { screen: track('screen.webm', 2000), camera: track('camera.webm', 2120) } }),
      DIR,
      'o.mp4',
      opts
    )
    const cam = args.indexOf(join(DIR, 'camera.webm'))
    expect(args.slice(cam - 3, cam)).toEqual(['-itsoffset', '0.12', '-i'])
    const scr = args.indexOf(join(DIR, 'screen.webm'))
    expect(args[scr - 2]).not.toBe('-itsoffset')
  })

  test('camera is cut into a circle and overlaid where the bubble was', () => {
    const args = buildMp4Args(
      manifest({
        tracks: { screen: track('screen.webm'), camera: track('camera.webm') },
        bubble: { xDip: 1000, yDip: 500, sizeDip: 200 }
      }),
      DIR,
      'o.mp4',
      opts
    )
    const f = filterOf(args)
    expect(f).toContain('scale=300:300')
    expect(f).toContain("geq=")
    expect(f).toContain('overlay=1500:750')
  })

  test('includeCamera=false leaves the camera out', () => {
    const args = buildMp4Args(
      manifest({ tracks: { screen: track('screen.webm'), camera: track('camera.webm') } }),
      DIR,
      'o.mp4',
      { ...opts, includeCamera: false }
    )
    expect(inputs(args)).toEqual([join(DIR, 'screen.webm')])
  })

  test('incomplete manifest still builds args from the tracks present', () => {
    const args = buildMp4Args(
      manifest({ status: 'incomplete', tracks: { screen: track('screen.webm'), mic: track('mic.webm') } }),
      DIR,
      'o.mp4',
      opts
    )
    expect(inputs(args)).toHaveLength(2)
  })

  test('a recording without a screen track cannot be exported', () => {
    expect(() => buildMp4Args(manifest({ tracks: {} }), DIR, 'o.mp4', opts)).toThrow(/screen/i)
  })
})

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

describe('buildGifArgs', () => {
  test('15 fps palette GIF of the cropped screen', () => {
    const args = buildGifArgs(manifest({ crop: { x: 0, y: 0, width: 800, height: 600 } }), DIR, 'o.gif', { fps: 15, width: 640 })
    const f = filterOf(args)
    expect(f).toContain('crop=800:600:0:0')
    expect(f).toContain('fps=15,scale=640:-1:flags=lanczos')
    expect(f).toContain('palettegen=stats_mode=full')
    expect(f).toContain('paletteuse=dither=sierra2_4a')
    expect(inputs(args)).toEqual([join(DIR, 'screen.webm')])
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
