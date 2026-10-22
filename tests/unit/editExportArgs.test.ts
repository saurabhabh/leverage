import { describe, test, expect } from 'vitest'
import { join } from 'path'
import { buildEditedGifArgs, buildEditedMp4Args } from '../../src/main/media/editExportArgs'
import type { EditDoc, Overlay } from '../../src/shared/edit'
import type { RecordingManifest } from '../../src/shared/types'

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
const count = (s: string, needle: string): number => s.split(needle).length - 1
const all = { screen: track('screen.webm'), camera: track('camera.webm', 100), mic: track('mic.webm', 50), system: track('system.webm') }
const camera = { visible: true, x: 10, y: 20, size: 200 }

describe('buildEditedMp4Args', () => {
  test('two clips → trim per clip and concat n=2 for each present track', () => {
    const args = buildEditedMp4Args(manifest(all), edit([[0, 1000], [2000, 3000]], { camera }), DIR, 'o.mp4', {}, MASK)
    const f = filterOf(args)
    expect(count(f, 'concat=n=2:v=1:a=0')).toBe(2) // screen + camera
    // Audio is mixed on the source timeline first, then cut once.
    expect(count(f, 'concat=n=2:v=0:a=1')).toBe(1)
    expect(f.indexOf('amix')).toBeLessThan(f.indexOf('atrim'))
    expect(f).toContain('trim=start=0:end=1,setpts=PTS-STARTPTS')
    expect(f).toContain('trim=start=2:end=3,setpts=PTS-STARTPTS')
    expect(f).toContain('atrim=start=2:end=3,asetpts=PTS-STARTPTS')
    expect(args.join(' ')).toContain('-t 2')
  })

  test('tracks are aligned by padding, not shifting: camera starts 100 ms late, mic 50 ms', () => {
    const f = filterOf(buildEditedMp4Args(manifest(all), edit([[0, 3000]], { camera }), DIR, 'o.mp4', {}, MASK))
    expect(f).toContain('tpad=start_duration=0.1:color=black')
    expect(f).toContain('adelay=50:all=1')
    expect(f).toContain('apad=whole_dur=3')
  })

  test('reordered clips trim in clip order', () => {
    const f = filterOf(buildEditedMp4Args(manifest(), edit([[2000, 3000], [0, 1000]]), DIR, 'o.mp4', {}, null))
    expect(f.indexOf('trim=start=2:end=3')).toBeLessThan(f.indexOf('trim=start=0:end=1'))
  })

  test('a single clip needs no split or concat', () => {
    const f = filterOf(buildEditedMp4Args(manifest(), edit([[0, 3000]]), DIR, 'o.mp4', {}, null))
    expect(f).not.toContain('split=')
    expect(f).not.toContain('concat=')
  })

  test('blur fully cut out is not in the graph; partly cut → enable covers only surviving output time', () => {
    const blur = (id: string, s: number, e: number): Overlay => ({
      id, kind: 'blur', srcStartMs: s, srcEndMs: e, rect: { x: 10, y: 10, width: 100, height: 50 }, strength: 8
    })
    const cut = buildEditedMp4Args(manifest(), edit([[0, 1000], [2000, 3000]], { overlays: [blur('a', 1200, 1800)] }), DIR, 'o.mp4', {}, null)
    expect(filterOf(cut)).not.toContain('boxblur')
    const part = buildEditedMp4Args(manifest(), edit([[0, 1000], [2000, 3000]], { overlays: [blur('a', 500, 2500)] }), DIR, 'o.mp4', {}, null)
    const f = filterOf(part)
    expect(f).toContain('crop=100:50:10:10,boxblur=8')
    expect(f).toContain("enable='between(t,0.5,1)+between(t,1,1.5)'")
  })

  test('blur rect is clamped inside the frame', () => {
    const o: Overlay = { id: 'b', kind: 'blur', srcStartMs: 0, srcEndMs: 3000, rect: { x: 1200, y: 700, width: 300, height: 100 }, strength: 5 }
    const f = filterOf(buildEditedMp4Args(manifest(), edit([[0, 3000]], { overlays: [o] }), DIR, 'o.mp4', {}, null))
    expect(f).toContain('crop=80:20:1200:700')
  })

  test('callout PNG input appears once with an enable over all its intervals; one with no intervals adds no input', () => {
    const text = (id: string, s: number, e: number): Overlay => ({
      id, kind: 'text', srcStartMs: s, srcEndMs: e, rect: { x: 0, y: 0, width: 0, height: 0 }, text: 'Hi', color: '#fff'
    })
    const pngs = { shown: join(DIR, 'overlays', 'shown.png'), gone: join(DIR, 'overlays', 'gone.png') }
    const args = buildEditedMp4Args(
      manifest(),
      edit([[0, 1000], [2000, 3000]], { overlays: [text('shown', 500, 2500), text('gone', 1200, 1800)] }),
      DIR,
      'o.mp4',
      pngs,
      null
    )
    expect(inputs(args).filter((i) => i.endsWith('.png'))).toEqual([pngs.shown])
    expect(filterOf(args)).toContain("overlay=0:0:enable='between(t,0.5,1)+between(t,1,1.5)'")
  })

  test('a callout without a rendered PNG is skipped rather than failing', () => {
    const o: Overlay = { id: 'x', kind: 'box', srcStartMs: 0, srcEndMs: 1000, rect: { x: 0, y: 0, width: 10, height: 10 }, text: '', color: '#fff' }
    const args = buildEditedMp4Args(manifest(), edit([[0, 3000]], { overlays: [o] }), DIR, 'o.mp4', {}, null)
    expect(inputs(args)).toEqual([join(DIR, 'screen.webm')])
  })

  test('muted mic is not mixed; gains apply to the rest', () => {
    const args = buildEditedMp4Args(
      manifest(all),
      edit([[0, 3000]], { muted: { mic: true, system: false }, gains: { mic: 1, system: 1.5 } }),
      DIR,
      'o.mp4',
      {},
      null
    )
    expect(inputs(args)).not.toContain(join(DIR, 'mic.webm'))
    expect(filterOf(args)).toContain('volume=1.5')
    expect(filterOf(args)).not.toContain('amix')
  })

  test('everything muted → no audio', () => {
    const args = buildEditedMp4Args(manifest(all), edit([[0, 3000]], { muted: { mic: true, system: true } }), DIR, 'o.mp4', {}, null)
    expect(args).toContain('-an')
  })

  test('camera: circle via mask + alphamerge at its position; hidden or missing → no camera input', () => {
    const shown = buildEditedMp4Args(manifest(all), edit([[0, 3000]], { camera }), DIR, 'o.mp4', {}, MASK)
    expect(inputs(shown)).toContain(join(DIR, 'camera.webm'))
    expect(inputs(shown)).toContain(MASK)
    expect(filterOf(shown)).toContain('alphamerge')
    expect(filterOf(shown)).toContain('overlay=10:20')
    expect(filterOf(shown)).not.toContain('geq')
    const hidden = buildEditedMp4Args(manifest(all), edit([[0, 3000]], { camera: { ...camera, visible: false } }), DIR, 'o.mp4', {}, MASK)
    expect(inputs(hidden)).not.toContain(join(DIR, 'camera.webm'))
    const noTrack = buildEditedMp4Args(manifest(), edit([[0, 3000]], { camera }), DIR, 'o.mp4', {}, MASK)
    expect(inputs(noTrack)).not.toContain(join(DIR, 'camera.webm'))
  })

  test('50 clips build and the graph has exactly 50 trims per present track', () => {
    const clips: [number, number][] = Array.from({ length: 50 }, (_, i) => [i * 60, i * 60 + 50 + 100])
    const f = filterOf(buildEditedMp4Args(manifest({ screen: track('screen.webm'), mic: track('mic.webm') }), edit(clips), DIR, 'o.mp4', {}, null))
    expect(count(f, '[0:v]') + count(f, ']trim=')).toBeGreaterThan(0)
    expect(count(f, ',setpts=PTS-STARTPTS')).toBe(50)
    expect(count(f, ',asetpts=PTS-STARTPTS')).toBe(50) // one mixed audio stream
  })

  test('no screen track cannot be exported', () => {
    expect(() => buildEditedMp4Args(manifest({}), edit([[0, 1000]]), DIR, 'o.mp4', {}, null)).toThrow(/screen/i)
  })
})

describe('buildEditedGifArgs', () => {
  test('applies the same cuts, then the 15 fps palette chain, without audio', () => {
    const args = buildEditedGifArgs(manifest(all), edit([[0, 1000], [2000, 3000]]), DIR, 'o.gif', {}, null, { fps: 15, width: 640 })
    const f = filterOf(args)
    expect(f).toContain('concat=n=2:v=1:a=0')
    expect(f).toContain('fps=15,scale=640:-1:flags=lanczos')
    expect(f).toContain('palettegen=stats_mode=full')
    expect(inputs(args)).not.toContain(join(DIR, 'mic.webm'))
  })
})
