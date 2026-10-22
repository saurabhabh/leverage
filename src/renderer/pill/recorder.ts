import { addWindow, gateDecision, newGate, windowLevels } from '../../shared/speechGate'
import type { DictationAudioInfo } from '../../shared/ipc'

const WINDOW_MS = 100

/**
 * One dictation's microphone: a WebM/Opus recording plus 100 ms level windows that feed the speech
 * gate (was anything said?) and the pill's level meter.
 */
export class DictationRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private ctx: AudioContext | null = null
  private timer = 0
  private chunks: Blob[] = []
  private gate = newGate()
  private startedAt = 0

  constructor(private readonly onLevel: (level: number) => void) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    this.ctx = new AudioContext()
    const analyser = this.ctx.createAnalyser()
    analyser.fftSize = 2048
    this.ctx.createMediaStreamSource(this.stream).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    this.timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      const { rms, peak } = windowLevels(samples)
      addWindow(this.gate, rms, peak)
      this.onLevel(Math.min(1, rms * 12))
    }, WINDOW_MS)
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime, audioBitsPerSecond: 64_000 })
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data)
    }
    this.recorder.start(250)
    this.startedAt = performance.now()
  }

  /** Stop and hand back the audio; `discard` throws it away (cancel). */
  async stop(discard = false): Promise<{ data: ArrayBuffer; info: DictationAudioInfo } | null> {
    const recorder = this.recorder
    const durationMs = this.startedAt ? performance.now() - this.startedAt : 0
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        recorder.stop()
      })
    }
    window.clearInterval(this.timer)
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close().catch(() => undefined)
    const blob = new Blob(this.chunks, { type: 'audio/webm' })
    const info = { durationMs, gate: gateDecision(this.gate) }
    this.reset()
    if (discard || !recorder) return null
    return { data: await blob.arrayBuffer(), info }
  }

  private reset(): void {
    this.stream = null
    this.recorder = null
    this.ctx = null
    this.chunks = []
    this.gate = newGate()
    this.startedAt = 0
  }
}
