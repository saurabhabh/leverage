import { useEffect, useState } from 'react'
import type { RecorderStatus } from '../../shared/ipc'

const mmss = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Floating controls shown while recording. Drag anywhere except the buttons to move it. */
export default function Toolbar(): React.JSX.Element {
  const [status, setStatus] = useState<RecorderStatus>({ phase: 'countdown', elapsedMs: 0 })

  useEffect(() => {
    void window.leverage['recorder:current']().then(setStatus)
    return window.leverage.on('recorder:status', setStatus)
  }, [])

  const send = (c: 'toggle' | 'pause' | 'abort') => () => void window.leverage['recorder:command'](c)
  const paused = status.phase === 'paused'

  return (
    <div className="toolbar">
      <span className={paused ? 'dot paused' : 'dot'} aria-hidden />
      <span className="time" aria-label="Elapsed time">
        {status.phase === 'countdown' ? 'Starting…' : mmss(status.elapsedMs)}
      </span>
      {!!status.warnings?.length && (
        <span className="warn" role="alert" title={status.warnings.join('\n')}>
          ⚠
        </span>
      )}
      <button onClick={send('pause')} disabled={status.phase === 'countdown'} title="Pause / resume">
        {paused ? 'Resume' : 'Pause'}
      </button>
      <button className="stop" onClick={send('toggle')} disabled={status.phase === 'countdown'} title="Stop and save">
        Stop
      </button>
      <button onClick={send('abort')} title="Discard recording">
        ✕
      </button>
    </div>
  )
}
