import { describe, test, expect, beforeEach } from 'vitest'
import {
  RecorderSession,
  type RecorderDeps,
  type RecorderLike,
  type TrackLike,
  type StreamLike
} from '../../src/renderer/src/studio/recorder'
import type { CaptureSource, RecordingManifest, TrackKind } from '../../src/shared/types'

class FakeTrack implements TrackLike {
  stopped = false
  private listeners: (() => void)[] = []
  constructor(
    public kind: 'audio' | 'video',
    private settings: { width?: number; height?: number } = {}
  ) {}
  stop(): void {
    this.stopped = true
  }
  getSettings(): { width?: number; height?: number } {
    return this.settings
  }
  addEventListener(_type: 'ended', fn: () => void): void {
    this.listeners.push(fn)
  }
  end(): void {
    this.listeners.forEach((fn) => fn())
  }
}

const stream = (...tracks: FakeTrack[]): StreamLike => ({
  getTracks: () => tracks,
  getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  getAudioTracks: () => tracks.filter((t) => t.kind === 'audio')
})

class FakeRecorder implements RecorderLike {
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstart: (() => void) | null = null
  onstop: (() => void) | null = null
  calls: string[] = []
  constructor(
    public stream: StreamLike,
    public mime: string,
    public bitrate: number
  ) {}
  start(timeslice: number): void {
    this.calls.push(`start:${timeslice}`)
    this.state = 'recording'
    queueMicrotask(() => this.onstart?.())
  }
  pause(): void {
    this.calls.push('pause')
    this.state = 'paused'
  }
  resume(): void {
    this.calls.push('resume')
    this.state = 'recording'
  }
  stop(): void {
    this.calls.push('stop')
    this.state = 'inactive'
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) })
      this.onstop?.()
    })
  }
  emit(bytes: number[]): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) })
  }
}

const source: CaptureSource = {
  id: 'screen:1:0',
  kind: 'screen',
  name: 'Screen 1',
  thumbnailDataUrl: '',
  displayId: '1',
  displayBoundsDip: { x: 0, y: 0, width: 1280, height: 720 },
  scaleFactor: 1.5
}

let log: string[]
let recorders: FakeRecorder[]
let tracks: Record<string, FakeTrack>
let clock: number
let deps: RecorderDeps
let userMediaError: Partial<Record<'audio' | 'video', string>>
let displayHasAudio: boolean

const recorderFor = (kind: TrackKind): FakeRecorder =>
  recorders.find((r) => r.stream.getTracks()[0] === tracks[kind])!

beforeEach(() => {
  log = []
  recorders = []
  clock = 1000
  userMediaError = {}
  displayHasAudio = true
  tracks = {
    screen: new FakeTrack('video', { width: 1920, height: 1080 }),
    system: new FakeTrack('audio'),
    camera: new FakeTrack('video', { width: 1280, height: 720 }),
    mic: new FakeTrack('audio')
  }
  const api = {
    'capture:select': async (id: string) => void log.push(`select:${id}`),
    'rec:create': async (init: { tracks: TrackKind[] }) => {
      log.push(`create:${init.tracks.join(',')}`)
      return { id: 'r1', dir: 'D:\\lib\\r1' }
    },
    'rec:chunk': async (_id: string, track: TrackKind, data: ArrayBuffer) =>
      void log.push(`chunk:${track}:${data.byteLength}`),
    'rec:offset': async (_id: string, track: TrackKind, ms: number) => void log.push(`offset:${track}:${ms}`),
    'rec:disable': async (_id: string, track: TrackKind, reason: string) =>
      void log.push(`disable:${track}:${reason}`),
    'rec:finalize': async (_id: string, ms: number) => {
      log.push(`finalize:${ms}`)
      return { id: 'r1' } as RecordingManifest
    },
    'rec:abort': async () => void log.push('abort')
  }
  deps = {
    api,
    now: () => clock,
    getDisplayMedia: async () => (displayHasAudio ? stream(tracks.screen, tracks.system) : stream(tracks.screen)),
    getUserMedia: async (c) => {
      const kind = c.video ? 'video' : 'audio'
      const err = userMediaError[kind]
      if (err) throw Object.assign(new Error(err), { name: err })
      return stream(kind === 'video' ? tracks.camera : tracks.mic)
    },
    makeStream: (ts) => stream(...(ts as FakeTrack[])),
    createRecorder: (s, mime, bitrate) => {
      const r = new FakeRecorder(s, mime, bitrate)
      recorders.push(r)
      return r
    },
    isTypeSupported: () => true
  }
})

const allOn = { sourceId: source.id, source, cameraId: 'cam', micId: 'mic', systemAudio: true }
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('RecorderSession', () => {
  test('prepare opens all four tracks, selects the source and creates the folder', async () => {
    const s = new RecorderSession(deps)
    const result = await s.prepare(allOn)
    expect(result).toEqual({ id: 'r1', disabled: {} })
    expect(log).toEqual(['select:screen:1:0', 'create:screen,camera,mic,system'])
    expect(recorders).toHaveLength(4)
    expect(recorderFor('screen').bitrate).toBe(8_000_000)
    expect(recorderFor('camera').bitrate).toBe(2_500_000)
    expect(recorderFor('mic').mime).toBe('audio/webm;codecs=opus')
    expect(s.state).toBe('prepared')
  })

  test('prepare with denied camera disables camera with reason and still prepares screen+mic', async () => {
    userMediaError.video = 'NotAllowedError'
    const s = new RecorderSession(deps)
    const result = await s.prepare(allOn)
    expect(result.disabled).toEqual({ camera: 'Camera permission denied' })
    expect(log).toContain('create:screen,mic,system')
    expect(log).toContain('disable:camera:Camera permission denied')
    expect(recorders).toHaveLength(3)
  })

  test('mic in use by another app gets its own reason', async () => {
    userMediaError.audio = 'NotReadableError'
    const result = await new RecorderSession(deps).prepare(allOn)
    expect(result.disabled.mic).toBe('Microphone is in use by another app')
  })

  test('prepare with no system audio track disables system with reason "No system audio available"', async () => {
    displayHasAudio = false
    const result = await new RecorderSession(deps).prepare(allOn)
    expect(result.disabled).toEqual({ system: 'No system audio available' })
  })

  test('system audio that fails to start falls back to screen-only capture with a reason', async () => {
    const calls: boolean[] = []
    deps.getDisplayMedia = async (c) => {
      calls.push(c.audio)
      if (c.audio) throw Object.assign(new Error('Could not start audio source'), { name: 'NotReadableError' })
      return stream(tracks.screen)
    }
    const result = await new RecorderSession(deps).prepare(allOn)
    expect(calls).toEqual([true, false])
    expect(result.disabled).toEqual({ system: 'System audio could not be captured' })
    expect(log).toContain('create:screen,camera,mic')
  })

  test('a screen capture failure without audio is still an error', async () => {
    deps.getDisplayMedia = async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    }
    await expect(new RecorderSession(deps).prepare({ ...allOn, systemAudio: false })).rejects.toThrow('denied')
  })

  test('a region drawn in DIP becomes a crop in captured-video pixels', async () => {
    let crop: unknown
    const create = deps.api['rec:create']
    deps.api['rec:create'] = async (init) => {
      crop = init.crop
      return create(init)
    }
    // source display is 1280×720 DIP; the fake screen track reports 1920×1080.
    await new RecorderSession(deps).prepare({ ...allOn, regionDip: { x: 100, y: 100, width: 201, height: 101 } })
    expect(crop).toEqual({ x: 150, y: 150, width: 300, height: 150 })
  })

  test('devices switched off are not opened and not reported as disabled', async () => {
    const result = await new RecorderSession(deps).prepare({ ...allOn, cameraId: undefined, systemAudio: false })
    expect(result.disabled).toEqual({})
    expect(log).toContain('create:screen,mic')
  })

  test('start starts every recorder in the same tick with a 1 s timeslice and records offsets', async () => {
    const s = new RecorderSession(deps)
    await s.prepare(allOn)
    s.start()
    expect(recorders.every((r) => r.calls[0] === 'start:1000')).toBe(true)
    clock = 1040
    await flush()
    expect(log.filter((l) => l.startsWith('offset:')).sort()).toEqual([
      'offset:camera:40',
      'offset:mic:40',
      'offset:screen:40',
      'offset:system:40'
    ])
    expect(s.state).toBe('recording')
  })

  test('pause/resume call pause/resume on every recorder and duration excludes the pause', async () => {
    const s = new RecorderSession(deps)
    await s.prepare(allOn)
    s.start()
    clock = 3000
    s.pause()
    expect(s.state).toBe('paused')
    clock = 10_000
    s.resume()
    clock = 11_000
    expect(recorders.every((r) => r.calls.join() === 'start:1000,pause,resume')).toBe(true)
    expect(s.elapsedMs()).toBe(3000)
  })

  test('stop flushes the last chunk before rec:finalize and stops all tracks', async () => {
    const s = new RecorderSession(deps)
    await s.prepare(allOn)
    s.start()
    recorderFor('screen').emit([9, 9])
    clock = 6000
    await s.stop()
    const finalizeAt = log.indexOf('finalize:5000')
    expect(finalizeAt).toBeGreaterThan(-1)
    const chunks = log.filter((l) => l.startsWith('chunk:'))
    expect(chunks).toContain('chunk:screen:2')
    expect(chunks.filter((c) => c.endsWith(':3'))).toHaveLength(4)
    expect(log.slice(finalizeAt + 1).some((l) => l.startsWith('chunk:'))).toBe(false)
    expect(Object.values(tracks).every((t) => t.stopped)).toBe(true)
  })

  test('empty chunks are not sent', async () => {
    const s = new RecorderSession(deps)
    await s.prepare(allOn)
    s.start()
    recorderFor('mic').emit([])
    await flush()
    expect(log.some((l) => l === 'chunk:mic:0')).toBe(false)
  })

  test('a track ending mid-recording (camera unplugged) disables only that track', async () => {
    const s = new RecorderSession(deps)
    await s.prepare(allOn)
    s.start()
    tracks.camera.end()
    await flush()
    expect(log).toContain('disable:camera:Camera disconnected')
    expect(recorderFor('camera').calls).toContain('stop')
    expect(recorderFor('screen').calls).not.toContain('stop')
    expect(s.state).toBe('recording')
  })

  test('the screen source ending (window closed) stops the whole session', async () => {
    let autoStopped = false
    const s = new RecorderSession(deps)
    s.onAutoStop = () => {
      autoStopped = true
    }
    await s.prepare(allOn)
    s.start()
    tracks.screen.end()
    await flush()
    await flush()
    expect(autoStopped).toBe(true)
    expect(log.some((l) => l.startsWith('finalize:'))).toBe(true)
  })

  test('abort stops recorders and tracks and deletes the recording', async () => {
    const s = new RecorderSession(deps)
    await s.prepare(allOn)
    s.start()
    await s.abort()
    expect(log).toContain('abort')
    expect(log.some((l) => l.startsWith('finalize'))).toBe(false)
    expect(Object.values(tracks).every((t) => t.stopped)).toBe(true)
  })

  test('aborting during the countdown (prepared, not started) also cleans up', async () => {
    const s = new RecorderSession(deps)
    await s.prepare(allOn)
    await s.abort()
    expect(log).toContain('abort')
    expect(tracks.screen.stopped).toBe(true)
  })
})
