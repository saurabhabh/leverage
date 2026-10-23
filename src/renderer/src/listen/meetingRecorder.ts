import type { NoteDoc } from '../../../shared/listen'

type Track = 'mic' | 'system'
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * A meeting: the microphone and the PC's sound (Windows loopback, as in Studio) recorded as two
 * tracks and streamed to the note's folder, so a crash keeps what was said. If system audio can't be
 * opened the meeting still records the mic, and the note says so.
 */
export class MeetingRecorder {
  private recorders: MediaRecorder[] = []
  private streams: MediaStream[] = []
  private sending: Promise<unknown> = Promise.resolve()
  private startedAt = 0
  note: NoteDoc | null = null

  async start(title: string): Promise<NoteDoc> {
    const api = window.leverage
    const note = await api['notes:meetingStart'](title)
    this.note = note
    const warn = (w: string): void => void api['notes:meetingWarn'](note.id, w)

    const tracks: [Track, MediaStream][] = []
    try {
      tracks.push([
        'mic',
        await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        })
      ])
    } catch (err) {
      warn(
        `Your microphone couldn’t be opened (${message(err)}), so only the PC’s sound is recorded.`
      )
    }
    try {
      // Its own claim, so a Studio recording being set up keeps the screen or window it picked.
      await api['capture:meetingAudio']()
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      display.getVideoTracks().forEach((t) => t.stop())
      if (!display.getAudioTracks().length) throw new Error('no audio')
      tracks.push(['system', new MediaStream(display.getAudioTracks())])
    } catch {
      warn(
        'System audio isn’t available, so only your microphone is recorded (other people may be missing).'
      )
    }
    if (!tracks.length) {
      await api['notes:meetingStop'](note.id, 0)
      throw new Error('Neither the microphone nor the PC’s sound could be opened.')
    }

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    for (const [track, stream] of tracks) {
      this.streams.push(stream)
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64_000 })
      rec.ondataavailable = (e) => {
        if (!e.data.size) return
        // Chunks go out in order; each is on disk before the next.
        this.sending = this.sending.then(async () =>
          api['notes:meetingChunk'](note.id, track, await e.data.arrayBuffer())
        )
      }
      rec.start(1000)
      this.recorders.push(rec)
    }
    this.startedAt = performance.now()
    return note
  }

  get elapsedMs(): number {
    return this.startedAt ? performance.now() - this.startedAt : 0
  }

  async stop(): Promise<void> {
    const note = this.note
    if (!note) return
    const durationMs = this.elapsedMs
    await Promise.all(
      this.recorders.map(
        (r) =>
          new Promise<void>((resolve) => {
            if (r.state === 'inactive') return resolve()
            r.onstop = () => resolve()
            r.stop()
          })
      )
    )
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()))
    await this.sending.catch(() => undefined)
    this.recorders = []
    this.streams = []
    this.note = null
    this.startedAt = 0
    await window.leverage['notes:meetingStop'](note.id, Math.round(durationMs))
  }
}
