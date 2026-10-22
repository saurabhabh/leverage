import { outputDurationMs, outputToSource, type EditDoc } from '../../../shared/edit'
import type { TrackKind } from '../../../shared/types'

export type MediaLike = {
  currentTime: number
  paused: boolean
  volume: number
  muted: boolean
  play(): Promise<void>
  pause(): void
}

type Deps = {
  media: Partial<Record<TrackKind, MediaLike>>
  /** Each track's start on the source timeline (relative to the earliest track). */
  offsetsMs: Partial<Record<TrackKind, number>>
  now: () => number
  raf: (cb: () => void) => unknown
  cancelRaf: (handle: unknown) => void
}

const DRIFT_MS = 150

/**
 * Plays an edit by steering one media element per track along the clip list. A wall-clock master
 * drives output time; elements are re-seeked at clip boundaries and whenever they drift.
 */
export class PlaybackController {
  onTime: ((outMs: number) => void) | null = null
  onEnded: (() => void) | null = null

  private edit: EditDoc | null = null
  private baseOut = 0
  private baseNow = 0
  private isPlaying = false
  private clipIndex = -1
  private handle: unknown = null

  constructor(private deps: Deps) {}

  get playing(): boolean {
    return this.isPlaying
  }

  get timeMs(): number {
    if (!this.edit) return 0
    const t = this.isPlaying ? this.baseOut + (this.deps.now() - this.baseNow) : this.baseOut
    return Math.min(Math.max(0, Math.round(t)), outputDurationMs(this.edit))
  }

  setEdit(e: EditDoc): void {
    const at = this.timeMs
    this.edit = e
    this.applyAudio()
    this.seek(at)
  }

  play(): void {
    if (!this.edit || this.isPlaying) return
    if (this.timeMs >= outputDurationMs(this.edit)) this.baseOut = 0
    this.baseNow = this.deps.now()
    this.isPlaying = true
    this.syncAll(this.baseOut)
    this.schedule()
  }

  pause(): void {
    if (!this.isPlaying) return
    this.baseOut = this.timeMs
    this.isPlaying = false
    if (this.handle !== null) this.deps.cancelRaf(this.handle)
    this.handle = null
    for (const m of Object.values(this.deps.media)) m?.pause()
  }

  seek(outMs: number): void {
    if (!this.edit) return
    this.baseOut = Math.min(Math.max(0, outMs), outputDurationMs(this.edit))
    this.baseNow = this.deps.now()
    this.syncAll(this.baseOut)
    this.onTime?.(this.timeMs)
  }

  private schedule(): void {
    this.handle = this.deps.raf(() => this.tick())
  }

  private tick(): void {
    if (!this.isPlaying || !this.edit) return
    const total = outputDurationMs(this.edit)
    const t = this.timeMs
    if (t >= total) {
      this.pause()
      this.baseOut = total
      this.onTime?.(total)
      this.onEnded?.()
      return
    }
    const { clipIndex, srcMs } = outputToSource(this.edit, t)
    if (clipIndex !== this.clipIndex) this.syncAll(t)
    else this.correct(srcMs)
    this.onTime?.(t)
    this.schedule()
  }

  /** Hard-seek every element to output time `outMs`. */
  private syncAll(outMs: number): void {
    if (!this.edit) return
    const { clipIndex, srcMs } = outputToSource(this.edit, outMs)
    this.clipIndex = clipIndex
    for (const [track, m] of this.entries()) {
      const local = srcMs - (this.deps.offsetsMs[track] ?? 0)
      if (local < 0) {
        m.pause()
        m.currentTime = 0
        continue
      }
      m.currentTime = local / 1000
      if (this.isPlaying) void m.play().catch(() => undefined)
      else m.pause()
    }
  }

  /** Within a clip: start late tracks once they begin, and re-seek any that drifted. */
  private correct(srcMs: number): void {
    for (const [track, m] of this.entries()) {
      const local = srcMs - (this.deps.offsetsMs[track] ?? 0)
      if (local < 0) {
        if (!m.paused) m.pause()
        continue
      }
      if (m.paused) {
        m.currentTime = local / 1000
        void m.play().catch(() => undefined)
      } else if (Math.abs(m.currentTime * 1000 - local) > DRIFT_MS) {
        m.currentTime = local / 1000
      }
    }
  }

  private applyAudio(): void {
    if (!this.edit) return
    for (const k of ['mic', 'system'] as const) {
      const m = this.deps.media[k]
      if (!m) continue
      // Preview can't amplify; export applies gains above 100 %.
      m.volume = Math.min(1, Math.max(0, this.edit.gains[k]))
      m.muted = this.edit.muted[k]
    }
  }

  private entries(): [TrackKind, MediaLike][] {
    return Object.entries(this.deps.media).filter((e): e is [TrackKind, MediaLike] => !!e[1])
  }
}
