import { describe, test, expect } from 'vitest'
import { join } from 'path'
import {
  buildConcatGifArgs,
  buildConcatMp4Args,
  buildSegmentArgs,
  planSegments
} from '../../src/main/media/editExportArgs'
import type { EditDoc, Overlay } from '../../src/shared/edit'
import type { Rect, RecordingManifest } from '../../src/shared/types'

const DIR = 'D:\\lib\\rec'
const MASK = join(DIR, 'overlays', 'mask.png')
const track = (file: string, offsetMs = 0): { file: string; mime: string; offsetMs: number } => ({ file, mime: 'x', offsetMs })

function manifest(tracks: RecordingManifest['tracks'] = { screen: track('screen.webm') }): RecordingManifest {
  return {
    version: 1,
    id: 'r1',
    title: 'Rec',
    createdAt: '2026-10-22T10:00:00.000Z',
    status: 'complete',
    durationMs: 3000,
    source: { kind: 'screen', name: 'S', scaleFactor: 1 },
    videoSize: { width: 1280, height: 720 },
    tracks,
    disabledTracks: {}
  }
}

function edit(clips: [number, number][], patch: Partial<EditDoc> = {}): EditDoc {
  return {
    version: 1,
    clips: clips.map(([s, e], i) => ({ id: `c${i}`, srcStartMs: s, srcEndMs: e })),
    overlays: [],
    camera: null,
    gains: { mic: 1, system: 1 },
    muted: { mic: false, system: false },
    ...patch
  }
}

const filterOf = (args: string[]): string => args[args.indexOf('-filter_complex') + 1]
const inputs = (args: string[]): string[] => args.filter((_, i) => args[i - 1] === '-i')
/** The -ss/-t values given before an input file. */
const seekOf = (args: string[], file: string): [string, string] | null => {
  const i = args.indexOf(file)
  return args[i - 5] === '-ss' ? [args[i - 4], args[i - 2]] : null
}
const all = { screen: track('screen.webm'), camera: track('camera.webm', 100), mic: track('mic.webm', 50), system: track('system.webm') }
const camera = { visible: true, x: 10, y: 20, size: 200 }
const seg = (
  m: RecordingManifest,
  e: EditDoc,
  i: number,
  pngs: Record<string, string> = {},
  mask: string | null = null,
  audio = true
): string[] => buildSegmentArgs(m, e, planSegments(e)[i], DIR, `seg${i}.mkv`, pngs, mask, { audio })

describe('planSegments', () => {
  test('one segment per clip, in output order, with output start times', () => {
    expect(planSegments(edit([[2000, 3000], [0, 1500]])).map((s) => [s.outStartMs, s.lenMs])).toEqual([
      [0, 1000],
      [1000, 1500]
    ])
  })
})

describe('buildSegmentArgs', () => {
  test('each input seeks straight to the clip (no decoding of skipped video) and the graph has no split/concat', () => {
    const args = seg(manifest(all), edit([[2000, 3000], [0, 1000]], { camera }), 0, {}, MASK)
    expect(seekOf(args, join(DIR, 'screen.webm'))).toEqual(['2', '1'])
    // Camera started 100 ms after the earliest track, so its own clock is 100 ms behind.
    expect(seekOf(args, join(DIR, 'camera.webm'))).toEqual(['1.9', '1'])
    expect(seekOf(args, join(DIR, 'mic.webm'))).toEqual(['1.95', '1'])
    const f = filterOf(args)
    expect(f).not.toContain('concat=')
    expect(f).not.toMatch(/split=\d/)
  })

  test('a track that starts during the clip is padded at the front', () => {
    const args = seg(manifest(all), edit([[0, 3000]], { camera }), 0, {}, MASK)
    expect(seekOf(args, join(DIR, 'camera.webm'))).toEqual(['0', '2.9'])
    const f = filterOf(args)
    expect(f).toContain('tpad=start_duration=0.1:color=black')
    expect(f).toContain('adelay=50:all=1')
    expect(f).toContain('apad=whole_dur=3')
    expect(f).toContain('trim=duration=3')
  })

  test('a track that has not started yet during the clip is left out of that segment', () => {
    const m = manifest({ screen: track('screen.webm'), system: track('system.webm', 2000) })
    const args = seg(m, edit([[0, 1000]]), 0)
    expect(inputs(args)).not.toContain(join(DIR, 'system.webm'))
    // Audio stays present (silence) so every segment has the same streams.
    expect(filterOf(args)).toContain('anullsrc')
  })

  test('segment output is H.264 at a constant 30 fps with PCM audio in Matroska', () => {
    const a = seg(manifest(all), edit([[0, 3000]]), 0).join(' ')
    expect(a).toContain('-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p')
    expect(a).toContain('-fps_mode cfr -r 30')
    expect(a).toContain('-c:a pcm_s16le -ar 48000 -ac 2')
    expect(a).toContain('-f matroska')
  })

  test('blur fully cut out is not in the segment; partly → local enable window', () => {
    const blur = (s: number, e: number): Overlay => ({
      id: 'b', kind: 'blur', srcStartMs: s, srcEndMs: e, rect: { x: 10, y: 10, width: 100, height: 50 }, strength: 8
    })
    const e1 = edit([[0, 1000], [2000, 3000]], { overlays: [blur(1200, 1800)] })
    expect(filterOf(seg(manifest(), e1, 0))).not.toContain('boxblur')
    expect(filterOf(seg(manifest(), e1, 1))).not.toContain('boxblur')
    const e2 = edit([[0, 1000], [2000, 3000]], { overlays: [blur(500, 2500)] })
    expect(filterOf(seg(manifest(), e2, 0))).toContain("enable='between(t,0.5,1)'")
    // Segment 2 plays source 2000–3000; the blur covers its first half second.
    expect(filterOf(seg(manifest(), e2, 1))).toContain("enable='between(t,0,0.5)'")
  })

  test('blur rects too thin for a valid chroma radius are skipped; radius fits both planes', () => {
    const at = (rect: Rect, strength = 10): string =>
      filterOf(seg(manifest(), edit([[0, 3000]], { overlays: [{ id: 'b', kind: 'blur', srcStartMs: 0, srcEndMs: 3000, rect, strength }] }), 0))
    expect(at({ x: 10, y: 10, width: 200, height: 2 })).not.toContain('boxblur')
    expect(at({ x: 1278, y: 10, width: 200, height: 100 })).not.toContain('boxblur')
    expect(at({ x: 10, y: 10, width: 8, height: 8 }, 20)).toContain('boxblur=2')
    expect(at({ x: 1200, y: 700, width: 300, height: 100 })).toContain('crop=80:20:1200:700')
  })

  test('callout PNG is an input only in segments where it shows; missing PNGs are skipped', () => {
    const text: Overlay = { id: 't', kind: 'text', srcStartMs: 500, srcEndMs: 900, rect: { x: 0, y: 0, width: 0, height: 0 }, text: 'Hi', color: '#fff' }
    const pngs = { t: join(DIR, 'overlays', 't.png') }
    const e = edit([[0, 1000], [2000, 3000]], { overlays: [text] })
    expect(inputs(seg(manifest(), e, 0, pngs))).toContain(pngs.t)
    expect(filterOf(seg(manifest(), e, 0, pngs))).toContain("overlay=0:0:enable='between(t,0.5,0.9)'")
    expect(inputs(seg(manifest(), e, 1, pngs))).not.toContain(pngs.t)
    expect(inputs(seg(manifest(), e, 0, {}))).toEqual([join(DIR, 'screen.webm')])
  })

  test('muted tracks are left out; gains apply; mic+system are mixed', () => {
    const muted = seg(manifest(all), edit([[0, 3000]], { muted: { mic: true, system: false }, gains: { mic: 1, system: 1.5 } }), 0)
    expect(inputs(muted)).not.toContain(join(DIR, 'mic.webm'))
    expect(filterOf(muted)).toContain('volume=1.5')
    expect(filterOf(seg(manifest(all), edit([[0, 3000]]), 0))).toContain('amix=inputs=2:normalize=0:duration=longest')
  })

  test('everything muted → segments without audio', () => {
    expect(seg(manifest(all), edit([[0, 3000]], { muted: { mic: true, system: true } }), 0)).toContain('-an')
  })

  test('camera: circle via mask + alphamerge at its position; hidden or missing → no camera', () => {
    const shown = seg(manifest(all), edit([[0, 3000]], { camera }), 0, {}, MASK)
    expect(inputs(shown)).toContain(MASK)
    expect(filterOf(shown)).toContain('alphamerge')
    expect(filterOf(shown)).toContain('overlay=10:20')
    expect(filterOf(shown)).not.toContain('geq')
    expect(inputs(seg(manifest(all), edit([[0, 3000]], { camera: { ...camera, visible: false } }), 0, {}, MASK))).not.toContain(
      join(DIR, 'camera.webm')
    )
    expect(inputs(seg(manifest(), edit([[0, 3000]], { camera }), 0, {}, MASK))).not.toContain(join(DIR, 'camera.webm'))
  })

  test('GIF segments carry no audio', () => {
    const args = seg(manifest(all), edit([[0, 3000]]), 0, {}, null, false)
    expect(inputs(args)).not.toContain(join(DIR, 'mic.webm'))
    expect(args).toContain('-an')
  })

  test('no screen track cannot be exported', () => {
    expect(() => seg(manifest({}), edit([[0, 1000]]), 0)).toThrow(/screen/i)
  })
})

describe('final join', () => {
  test('MP4: concat the segments, copy video, encode audio once', () => {
    const a = buildConcatMp4Args('list.txt', 'out.mp4', true).join(' ')
    expect(a).toContain('-f concat -safe 0 -i list.txt')
    expect(a).toContain('-c:v copy -c:a aac -b:a 192k')
    expect(a).toContain('-movflags +faststart -n out.mp4')
    expect(buildConcatMp4Args('list.txt', 'out.mp4', false)).toContain('-an')
  })

  test('GIF: concat then the 15 fps palette chain', () => {
    const f = filterOf(buildConcatGifArgs('list.txt', 'o.gif', { fps: 15, width: 640 }))
    expect(f).toContain('fps=15,scale=640:-1:flags=lanczos')
    expect(f).toContain('palettegen=stats_mode=full')
  })
})
