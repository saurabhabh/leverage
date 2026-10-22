import { test, expect, beforeEach } from 'vitest'
import { PlaybackController, type MediaLike } from '../../src/renderer/src/editor/player'
import type { EditDoc } from '../../src/shared/edit'

class FakeMedia implements MediaLike {
  currentTime = 0
  paused = true
  volume = 1
  muted = false
  duration = NaN
  play(): Promise<void> {
    // Like a real media element: play() on an ended element restarts it from 0.
    if (Number.isFinite(this.duration) && this.currentTime >= this.duration) this.currentTime = 0
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
}

const doc = (clips: [number, number][], patch: Partial<EditDoc> = {}): EditDoc => ({
  version: 1,
  clips: clips.map(([s, e], i) => ({ id: `c${i}`, srcStartMs: s, srcEndMs: e })),
  overlays: [],
  camera: null,
  gains: { mic: 1, system: 1 },
  muted: { mic: false, system: false },
  ...patch
})

let clock: number
let frames: (() => void)[]
let screen: FakeMedia
let mic: FakeMedia
let system: FakeMedia
let player: PlaybackController

const frame = (): void => {
  const pending = frames
  frames = []
  pending.forEach((f) => f())
}

beforeEach(() => {
  clock = 0
  frames = []
  screen = new FakeMedia()
  mic = new FakeMedia()
  system = new FakeMedia()
  player = new PlaybackController({
    media: { screen, mic, system },
    offsetsMs: { screen: 0, mic: 500, system: 0 },
    now: () => clock,
    raf: (cb) => frames.push(cb),
    cancelRaf: () => {
      frames = []
    }
  })
})

test('seek maps output time to each element through the clip list and offsets', () => {
  player.setEdit(doc([[5000, 8000], [0, 2000]]))
  player.seek(1000)
  expect(player.timeMs).toBe(1000)
  expect(screen.currentTime).toBeCloseTo(6.0)
  expect(mic.currentTime).toBeCloseTo(5.5)
})

test('playing across a clip boundary jumps every element to the next clip', () => {
  player.setEdit(doc([[5000, 8000], [0, 2000]]))
  player.seek(2900)
  player.play()
  clock += 200
  frame()
  expect(player.timeMs).toBe(3100)
  expect(screen.currentTime).toBeCloseTo(0.1)
  // mic starts 500 ms into the source timeline, so at source 100 ms it has not started yet.
  expect(mic.paused).toBe(true)
  expect(screen.paused).toBe(false)
})

test('a track with a positive offset stays paused until its start', () => {
  player.setEdit(doc([[0, 10_000]]))
  player.seek(0)
  player.play()
  expect(mic.paused).toBe(true)
  clock += 700
  frame()
  expect(mic.paused).toBe(false)
  expect(mic.currentTime).toBeCloseTo(0.2, 1)
})

test('drift over 150 ms is corrected', () => {
  player.setEdit(doc([[0, 10_000]]))
  player.seek(1000)
  player.play()
  screen.currentTime = 5 // the element wandered off
  clock += 100
  frame()
  expect(screen.currentTime).toBeCloseTo(1.1)
})

test('small drift is left alone', () => {
  player.setEdit(doc([[0, 10_000]]))
  player.seek(1000)
  player.play()
  screen.currentTime = 1.05
  clock += 50
  frame()
  expect(screen.currentTime).toBe(1.05)
})

test('reaching the end pauses and fires onEnded', () => {
  let ended = false
  player.onEnded = () => {
    ended = true
  }
  player.setEdit(doc([[0, 1000]]))
  player.play()
  clock += 1500
  frame()
  expect(ended).toBe(true)
  expect(player.timeMs).toBe(1000)
  expect(screen.paused).toBe(true)
  expect(player.playing).toBe(false)
})

test('muted and gain are applied to mic and system elements', () => {
  player.setEdit(doc([[0, 1000]], { gains: { mic: 2, system: 0.5 }, muted: { mic: false, system: true } }))
  expect(mic.volume).toBe(1)
  expect(mic.muted).toBe(false)
  expect(system.volume).toBe(0.5)
  expect(system.muted).toBe(true)
})

test('setEdit that shortens the timeline clamps the playhead', () => {
  player.setEdit(doc([[0, 10_000]]))
  player.seek(8000)
  player.setEdit(doc([[0, 2000]]))
  expect(player.timeMs).toBe(2000)
})

test('onTime reports output time on every frame while playing', () => {
  const seen: number[] = []
  player.onTime = (t) => seen.push(t)
  player.setEdit(doc([[0, 10_000]]))
  player.play()
  clock += 40
  frame()
  clock += 40
  frame()
  expect(seen.slice(-2)).toEqual([40, 80])
})

test('a track that ended early stays at its end instead of restarting', () => {
  mic.duration = 1 // mic stopped (unplugged) 1 s into its own timeline
  player.setEdit(doc([[0, 10_000]]))
  player.seek(3000)
  player.play()
  for (let i = 0; i < 5; i++) {
    clock += 100
    frame()
  }
  expect(mic.paused).toBe(true)
  expect(mic.currentTime).toBeCloseTo(1)
  expect(screen.paused).toBe(false)
})
