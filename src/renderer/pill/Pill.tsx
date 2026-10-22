import { useEffect, useRef, useState } from 'react'
import type { DictationStatus } from '../../shared/listen'
import { DictationRecorder } from './recorder'

const BARS = 9
const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The dictation pill. It owns the microphone while recording; main tells it when to start, stop or
 * cancel (hotkey, tray, Esc) and reports progress back through `dictate:status`.
 */
export default function Pill(): React.JSX.Element {
  const [status, setStatus] = useState<DictationStatus>({ phase: 'idle' })
  const [levels, setLevels] = useState<number[]>(Array(BARS).fill(0))
  const [elapsed, setElapsed] = useState(0)
  const recorder = useRef<DictationRecorder | null>(null)
  const id = useRef('')
  const started = useRef(0)
  // Stop/cancel wait for the mic to finish opening, so a quick double press can't strand a recording.
  const starting = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    recorder.current = new DictationRecorder((level) => setLevels((l) => [...l.slice(1), level]))
    const offStatus = window.leverage.on('dictate:status', setStatus)
    const offCommand = window.leverage.on('dictate:command', async (c) => {
      const r = recorder.current!
      if (c.action === 'start') {
        id.current = c.id
        started.current = Date.now()
        setElapsed(0)
        setLevels(Array(BARS).fill(0))
        starting.current = r.start().catch(async (err) => {
          await r.stop(true)
          void window.leverage['dictate:micError'](err instanceof Error ? err.message : String(err))
        })
        await starting.current
      } else if (c.action === 'stop') {
        await starting.current
        const result = await r.stop()
        if (result) void window.leverage['dictate:audio'](id.current, result.data, result.info)
        else void window.leverage['dictate:cancel']()
      } else {
        await starting.current
        await r.stop(true)
        void window.leverage['dictate:cancel']()
      }
    })
    // Asked only once listening: main holds its first command until the pill has called this.
    window.leverage['dictate:current']().then(setStatus)
    return () => {
      offStatus()
      offCommand()
    }
  }, [])

  useEffect(() => {
    if (status.phase !== 'recording') return
    const t = window.setInterval(() => setElapsed(Date.now() - started.current), 250)
    return () => window.clearInterval(t)
  }, [status.phase])

  return (
    <div className={`pill ${status.phase}`} data-testid="pill" data-phase={status.phase}>
      {status.phase === 'recording' && (
        <>
          <span className="dot" />
          <span className="bars" aria-hidden>
            {levels.map((l, i) => (
              <span key={i} style={{ height: `${Math.max(12, l * 100)}%` }} />
            ))}
          </span>
          <span className="time">{clock(elapsed)}</span>
          <button
            className="pill-btn stop"
            title="Stop and paste"
            onClick={() => void window.leverage['dictate:toggle']()}
          >
            Done
          </button>
          <button
            className="pill-btn"
            title="Cancel (Esc)"
            aria-label="Cancel"
            onClick={() =>
              void recorder.current?.stop(true).then(() => window.leverage['dictate:cancel']())
            }
          >
            ×
          </button>
        </>
      )}
      {status.phase === 'transcribing' && (
        <>
          <span className="spinner" />
          <span className="label">Transcribing…</span>
        </>
      )}
      {status.phase === 'done' && (
        <span className="label">{status.message === 'Pasted' ? '✓ Pasted' : status.message}</span>
      )}
      {status.phase === 'error' && (
        <span className="label error" title={status.message}>
          {status.message}
        </span>
      )}
    </div>
  )
}
