import { useEffect, useRef, useState } from 'react'
import type { RecorderCommand, RecorderStatus } from '../../../shared/ipc'
import type { Rect, RecordingManifest, TrackKind } from '../../../shared/types'
import RecordSetup, { type RecordChoice } from './RecordSetup'
import { RecorderSession } from './recorder'
import { browserDeps } from './browserDeps'

type Phase =
  | { name: 'setup' }
  | { name: 'preparing' }
  | { name: 'countdown'; left: number }
  | { name: 'recording' }
  | { name: 'saving' }
  | { name: 'done'; manifest: RecordingManifest }

const TRACK_LABEL: Record<TrackKind, string> = {
  screen: 'Screen',
  camera: 'Camera',
  mic: 'Microphone',
  system: 'System audio'
}

const mmss = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function Studio(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ name: 'setup' })
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const session = useRef<RecorderSession | null>(null)
  const countdownTimer = useRef<number | null>(null)
  const latestChoice = useRef<RecordChoice | null>(null)
  const target = useRef<{ displayId?: string; cameraId?: string }>({})
  const commands = useRef<Record<RecorderCommand, () => void>>({ toggle: () => {}, pause: () => {}, abort: () => {} })

  // Tell the toolbar, bubble, tray and hotkeys what the recorder is doing.
  useEffect(() => {
    const phaseOf: Record<Phase['name'], RecorderStatus['phase']> = {
      setup: 'idle',
      preparing: 'idle',
      done: 'idle',
      countdown: 'countdown',
      recording: paused ? 'paused' : 'recording',
      saving: 'saving'
    }
    const p = phaseOf[phase.name]
    void window.leverage['recorder:status']({
      phase: p,
      elapsedMs: elapsed,
      ...(p === 'idle' ? {} : { ...target.current, warnings })
    })
  }, [phase.name, paused, elapsed, warnings])

  useEffect(() => window.leverage.on('recorder:command', (c) => commands.current[c]()), [])

  useEffect(() => {
    if (phase.name !== 'recording') return
    const t = window.setInterval(() => setElapsed(session.current?.elapsedMs() ?? 0), 250)
    return () => window.clearInterval(t)
  }, [phase.name])

  const addWarning = (kind: TrackKind, reason: string): void =>
    setWarnings((w) => [...w, `${TRACK_LABEL[kind]} is off: ${reason}`])

  const finished = (manifest: RecordingManifest): void => {
    session.current = null
    void window.leverage['window:restore']()
    setPhase({ name: 'done', manifest })
  }

  const begin = (): void => {
    const s = session.current
    if (!s) return
    s.start()
    setPaused(false)
    setPhase({ name: 'recording' })
    void window.leverage['window:minimize']()
  }

  const record = async (choice: RecordChoice, regionDip?: Rect): Promise<void> => {
    setError(null)
    setWarnings([])
    setPhase({ name: 'preparing' })
    const s = new RecorderSession(browserDeps())
    s.onAutoStop = finished
    s.onTrackDisabled = addWarning
    s.onError = (kind, message) =>
      setWarnings((w) => {
        const text = `${TRACK_LABEL[kind]} could not be saved: ${message}`
        return w.includes(text) ? w : [...w, text]
      })
    target.current = { displayId: choice.source.displayId, cameraId: choice.cameraId }
    try {
      const { id, disabled } = await s.prepare({ ...choice, sourceId: choice.source.id, regionDip })
      if (disabled.camera) target.current.cameraId = undefined
      s.beforeFinalize = async () => {
        const bubble = await window.leverage['bubble:placement']()
        if (bubble) await window.leverage['rec:update'](id, { bubble })
      }
      for (const [kind, reason] of Object.entries(disabled) as [TrackKind, string][]) addWarning(kind, reason)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase({ name: 'setup' })
      return
    }
    session.current = s
    const { countdownSec } = await window.leverage['settings:get']()
    if (countdownSec <= 0) return begin()
    let left = countdownSec
    setPhase({ name: 'countdown', left })
    countdownTimer.current = window.setInterval(() => {
      left -= 1
      if (left > 0) return setPhase({ name: 'countdown', left })
      window.clearInterval(countdownTimer.current!)
      begin()
    }, 1000)
  }

  const recordRegion = async (devices: Omit<RecordChoice, 'source'>): Promise<void> => {
    setError(null)
    const picked = await window.leverage['region:pick']()
    if (!picked) return
    const sources = await window.leverage['capture:list']()
    const source = sources.find((s) => s.kind === 'screen' && s.displayId === picked.displayId)
    if (!source) {
      setError('That screen is no longer available.')
      return
    }
    await record({ ...devices, source }, picked.rectDip)
  }

  const stop = async (): Promise<void> => {
    const s = session.current
    if (!s) return
    setPhase({ name: 'saving' })
    try {
      finished(await s.stop())
    } catch (err) {
      session.current = null
      setError(`The recording could not be finished: ${err instanceof Error ? err.message : String(err)}`)
      setPhase({ name: 'setup' })
      void window.leverage['window:restore']()
    }
  }

  const togglePause = (): void => {
    const s = session.current
    if (!s) return
    if (s.state === 'paused') s.resume()
    else s.pause()
    setPaused(s.state === 'paused')
  }

  const abort = async (): Promise<void> => {
    if (!session.current) return
    const { confirmAbort } = await window.leverage['settings:get']()
    if (confirmAbort && !window.confirm('Discard this recording?')) return
    await abortNow()
  }

  const abortNow = async (): Promise<void> => {
    const s = session.current
    if (!s) return
    if (countdownTimer.current) window.clearInterval(countdownTimer.current)
    session.current = null
    await s.abort()
    void window.leverage['window:restore']()
    setPhase({ name: 'setup' })
  }

  commands.current = {
    toggle: () => {
      if (phase.name === 'setup' && latestChoice.current) void record(latestChoice.current)
      else if (phase.name === 'done') setPhase({ name: 'setup' })
      else if (phase.name === 'recording') void stop()
    },
    pause: () => {
      if (phase.name === 'recording') togglePause()
    },
    // Already confirmed by the main process.
    abort: () => void abortNow()
  }

  return (
    <>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="banner warning" role="status">
          {warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      {(phase.name === 'setup' || phase.name === 'preparing') && (
        <RecordSetup
          busy={phase.name === 'preparing'}
          onRecord={(c) => void record(c)}
          onRegion={(d) => void recordRegion(d)}
          onChoiceChange={(c) => (latestChoice.current = c)}
        />
      )}

      {phase.name === 'countdown' && (
        <div className="countdown" aria-live="assertive">
          <div className="countdown-number">{phase.left}</div>
          <button className="btn" onClick={abort}>
            Cancel
          </button>
        </div>
      )}

      {(phase.name === 'recording' || phase.name === 'saving') && (
        <div className="page">
          <h1>{phase.name === 'saving' ? 'Saving…' : paused ? 'Paused' : 'Recording'}</h1>
          <div className="card recording-controls">
            <span className="timer">{mmss(elapsed)}</span>
            <button className="btn" onClick={togglePause} disabled={phase.name === 'saving'}>
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button className="btn primary" onClick={stop} disabled={phase.name === 'saving'}>
              Stop
            </button>
            <button className="btn" onClick={abort} disabled={phase.name === 'saving'}>
              Abort
            </button>
          </div>
        </div>
      )}

      {phase.name === 'done' && (
        <div className="page">
          <h1>Recording saved</h1>
          <div className="card">
            <p>
              {phase.manifest.title} · {mmss(phase.manifest.durationMs)} ·{' '}
              {Object.keys(phase.manifest.tracks).map((k) => TRACK_LABEL[k as TrackKind]).join(', ')}
            </p>
            <button className="btn primary" onClick={() => setPhase({ name: 'setup' })}>
              New recording
            </button>
          </div>
        </div>
      )}
    </>
  )
}
