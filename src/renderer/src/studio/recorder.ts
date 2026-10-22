import type { InvokeApi } from '../../../shared/ipc'
import type { CaptureSource, RecordingManifest, Rect, TrackKind } from '../../../shared/types'
import { dipRectToVideoRect } from '../../../shared/region'
import { pickMimeType } from './mime'

/** Structural subsets of the browser media types, so the session can be tested without a browser. */
export type TrackLike = {
  kind: string
  stop(): void
  getSettings(): { width?: number; height?: number }
  addEventListener(type: 'ended', listener: () => void): void
}
export type StreamLike = {
  getTracks(): TrackLike[]
  getVideoTracks(): TrackLike[]
  getAudioTracks(): TrackLike[]
}
export type RecorderLike = {
  state: 'inactive' | 'recording' | 'paused'
  ondataavailable: ((e: { data: Blob }) => void) | null
  onstart: (() => void) | null
  onstop: (() => void) | null
  start(timesliceMs: number): void
  pause(): void
  resume(): void
  stop(): void
}

type Api = Pick<
  InvokeApi,
  'capture:select' | 'rec:create' | 'rec:chunk' | 'rec:offset' | 'rec:disable' | 'rec:finalize' | 'rec:abort'
>

export type RecorderDeps = {
  api: Api
  now: () => number
  getDisplayMedia: (constraints: { video: unknown; audio: boolean }) => Promise<StreamLike>
  getUserMedia: (constraints: { video?: unknown; audio?: unknown }) => Promise<StreamLike>
  makeStream: (tracks: TrackLike[]) => StreamLike
  createRecorder: (stream: StreamLike, mime: string, bitsPerSecond: number) => RecorderLike
  isTypeSupported: (mime: string) => boolean
}

export type PrepareOptions = {
  sourceId: string
  source: CaptureSource
  cameraId?: string
  micId?: string
  systemAudio: boolean
  /** Area drawn in the region overlay, in global DIP; becomes the manifest crop. */
  regionDip?: Rect
}

export type PrepareResult = { id: string; disabled: Partial<Record<TrackKind, string>> }

const TIMESLICE_MS = 1000
const BITRATE: Record<TrackKind, number> = {
  screen: 8_000_000,
  camera: 2_500_000,
  mic: 128_000,
  system: 128_000
}
const DEVICE_NAME: Record<'camera' | 'mic', string> = { camera: 'Camera', mic: 'Microphone' }
const DISCONNECTED: Record<TrackKind, string> = {
  screen: 'Screen capture ended',
  camera: 'Camera disconnected',
  mic: 'Microphone disconnected',
  system: 'System audio ended'
}

export function deviceErrorReason(device: 'camera' | 'mic', err: unknown): string {
  const name = DEVICE_NAME[device]
  switch ((err as { name?: string })?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `${name} permission denied`
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `${name} not found`
    case 'NotReadableError':
    case 'AbortError':
      return `${name} is in use by another app`
    default:
      return `${name} unavailable`
  }
}

type Active = { kind: TrackKind; stream: StreamLike; recorder: RecorderLike; stopped?: Promise<void> }

/**
 * One recording: one MediaRecorder per track (screen, camera, mic, system audio), all started in the
 * same tick and paused together. Chunks stream to the main process as they arrive.
 * Mirrors ShareX's "prepare during the countdown" so start() is instant.
 */
export class RecorderSession {
  state: 'idle' | 'prepared' | 'recording' | 'paused' | 'stopped' = 'idle'
  /** Called when recording stops on its own (the captured window/screen went away). */
  onAutoStop: ((manifest: RecordingManifest) => void) | null = null
  /** Called when a track drops out mid-recording. */
  onTrackDisabled: ((kind: TrackKind, reason: string) => void) | null = null
  /** Runs after the last chunk is written and before the recording is finalized (e.g. save bubble position). */
  beforeFinalize: (() => Promise<void>) | null = null

  private id = ''
  private active: Active[] = []
  private sending: Promise<void> = Promise.resolve()
  private t0 = 0
  private pausedAt = 0
  private pausedTotal = 0
  private finishing: Promise<unknown> | null = null

  constructor(private deps: RecorderDeps) {}

  async prepare(opts: PrepareOptions): Promise<PrepareResult> {
    const { api } = this.deps
    await api['capture:select'](opts.sourceId)
    const disabled: PrepareResult['disabled'] = {}
    const streams: Partial<Record<TrackKind, StreamLike>> = {}

    const video = { frameRate: 30, cursor: 'always' }
    let display: StreamLike
    try {
      display = await this.deps.getDisplayMedia({ video, audio: opts.systemAudio })
    } catch (err) {
      if (!opts.systemAudio) throw err
      // Windows can refuse loopback audio (no output device, exclusive mode); keep the screen.
      display = await this.deps.getDisplayMedia({ video, audio: false })
      disabled.system = 'System audio could not be captured'
    }
    const screenTrack = display.getVideoTracks()[0]
    if (!screenTrack) throw new Error('The selected screen or window could not be captured.')
    streams.screen = this.deps.makeStream([screenTrack])
    const systemTrack = display.getAudioTracks()[0]
    if (!opts.systemAudio) systemTrack?.stop()
    else if (systemTrack) streams.system = this.deps.makeStream([systemTrack])
    else disabled.system ??= 'No system audio available'

    if (opts.cameraId) {
      try {
        streams.camera = await this.deps.getUserMedia({
          video: { deviceId: { exact: opts.cameraId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
        })
      } catch (err) {
        disabled.camera = deviceErrorReason('camera', err)
      }
    }
    if (opts.micId) {
      try {
        streams.mic = await this.deps.getUserMedia({
          audio: { deviceId: { exact: opts.micId }, echoCancellation: true, noiseSuppression: true }
        })
      } catch (err) {
        disabled.mic = deviceErrorReason('mic', err)
      }
    }

    const order: TrackKind[] = ['screen', 'camera', 'mic', 'system']
    const kinds = order.filter((k) => streams[k])
    const mimes: Partial<Record<TrackKind, string>> = {}
    for (const k of kinds) mimes[k] = pickMimeType(k === 'screen' || k === 'camera' ? 'video' : 'audio', this.deps.isTypeSupported)

    const { width = 0, height = 0 } = screenTrack.getSettings()
    const bounds = opts.source.displayBoundsDip
    const crop = opts.regionDip && bounds && width && height ? dipRectToVideoRect(opts.regionDip, bounds, { width, height }) : undefined
    try {
      const created = await api['rec:create']({
        source: {
          kind: opts.source.kind,
          name: opts.source.name,
          scaleFactor: opts.source.scaleFactor,
          ...(opts.source.displayBoundsDip ? { displayBoundsDip: opts.source.displayBoundsDip } : {})
        },
        videoSize: { width, height },
        ...(crop ? { crop } : {}),
        tracks: kinds,
        mimes
      })
      this.id = created.id
    } catch (err) {
      for (const k of kinds) streams[k]!.getTracks().forEach((t) => t.stop())
      throw err
    }
    for (const [kind, reason] of Object.entries(disabled) as [TrackKind, string][]) {
      await api['rec:disable'](this.id, kind, reason)
    }

    for (const kind of kinds) {
      const stream = streams[kind]!
      const recorder = this.deps.createRecorder(stream, mimes[kind]!, BITRATE[kind])
      const entry: Active = { kind, stream, recorder }
      recorder.ondataavailable = (e) => this.send(kind, e.data)
      stream.getTracks()[0].addEventListener('ended', () => void this.trackEnded(entry))
      this.active.push(entry)
    }
    this.state = 'prepared'
    return { id: this.id, disabled }
  }

  start(): void {
    if (this.state !== 'prepared') throw new Error(`Cannot start from ${this.state}`)
    this.t0 = this.deps.now()
    for (const entry of this.active) {
      entry.recorder.onstart = () => {
        const offset = Math.max(0, Math.round(this.deps.now() - this.t0))
        void this.deps.api['rec:offset'](this.id, entry.kind, offset)
      }
    }
    for (const entry of this.active) entry.recorder.start(TIMESLICE_MS)
    this.state = 'recording'
  }

  pause(): void {
    if (this.state !== 'recording') return
    this.pausedAt = this.deps.now()
    for (const e of this.live()) e.recorder.pause()
    this.state = 'paused'
  }

  resume(): void {
    if (this.state !== 'paused') return
    this.pausedTotal += this.deps.now() - this.pausedAt
    for (const e of this.live()) e.recorder.resume()
    this.state = 'recording'
  }

  elapsedMs(): number {
    if (this.state === 'idle' || this.state === 'prepared') return 0
    const end = this.state === 'paused' ? this.pausedAt : this.deps.now()
    return Math.max(0, Math.round(end - this.t0 - this.pausedTotal))
  }

  stop(): Promise<RecordingManifest> {
    this.finishing ??= this.doStop()
    return this.finishing as Promise<RecordingManifest>
  }

  abort(): Promise<void> {
    this.finishing ??= this.doAbort()
    return this.finishing as Promise<void>
  }

  private async doStop(): Promise<RecordingManifest> {
    if (this.state === 'paused') this.resume()
    const durationMs = this.elapsedMs()
    this.state = 'stopped'
    await Promise.all(this.active.map((e) => this.stopRecorder(e)))
    this.releaseTracks()
    await this.sending
    try {
      await this.beforeFinalize?.()
    } catch {
      // Optional metadata; never block saving the recording.
    }
    return this.deps.api['rec:finalize'](this.id, durationMs)
  }

  private async doAbort(): Promise<void> {
    this.state = 'stopped'
    await Promise.all(this.active.map((e) => this.stopRecorder(e)))
    this.releaseTracks()
    await this.sending.catch(() => undefined)
    if (this.id) await this.deps.api['rec:abort'](this.id)
  }

  private live(): Active[] {
    return this.active.filter((e) => e.recorder.state !== 'inactive')
  }

  private stopRecorder(entry: Active): Promise<void> {
    if (entry.stopped) return entry.stopped
    if (entry.recorder.state === 'inactive') return (entry.stopped = Promise.resolve())
    entry.stopped = new Promise<void>((resolve) => {
      // The final dataavailable fires before stop, so its send is already queued on this.sending.
      entry.recorder.onstop = () => resolve()
    })
    entry.recorder.stop()
    return entry.stopped
  }

  private releaseTracks(): void {
    for (const e of this.active) e.stream.getTracks().forEach((t) => t.stop())
  }

  private send(kind: TrackKind, data: Blob): void {
    if (data.size === 0) return
    this.sending = this.sending.then(async () => {
      await this.deps.api['rec:chunk'](this.id, kind, await data.arrayBuffer())
    })
  }

  private async trackEnded(entry: Active): Promise<void> {
    if (this.state === 'stopped' || this.state === 'idle') return
    if (entry.kind === 'screen') {
      const manifest = await this.stop()
      this.onAutoStop?.(manifest)
      return
    }
    const reason = DISCONNECTED[entry.kind]
    await this.stopRecorder(entry)
    await this.deps.api['rec:disable'](this.id, entry.kind, reason)
    this.onTrackDisabled?.(entry.kind, reason)
  }
}
