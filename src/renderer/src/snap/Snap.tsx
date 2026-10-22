import { useEffect, useState } from 'react'
import type { SnapMode } from '../../../shared/snap'
import SnapEditor from './SnapEditor'
import SnapGallery from './SnapGallery'
import './snap.css'

const DELAYS = [0, 3, 5, 10]
const pretty = (accelerator: string): string => accelerator.replace('CommandOrControl', 'Ctrl')

/** Snap home: capture buttons and the gallery, or the editor when a shot is open. */
export default function Snap({
  editing,
  onEdit
}: {
  editing: string | null
  onEdit: (id: string | null) => void
}): React.JSX.Element {
  const [delay, setDelay] = useState(0)
  const [hotkey, setHotkey] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.leverage['settings:get']().then((s) => setHotkey(s.snap.hotkey))
    return window.leverage.on('settings:changed', (s) => setHotkey(s.snap.hotkey))
  }, [])

  if (editing) return <SnapEditor key={editing} id={editing} onBack={() => onEdit(null)} />

  const capture = (mode: SnapMode): void => {
    setError(null)
    window.leverage['snap:capture'](mode, delay).catch((err) =>
      setError(
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : String(err)
      )
    )
  }

  return (
    <div className="page snap-page">
      <h1>Snap</h1>
      <section className="card">
        <div className="row">
          <button className="btn primary" onClick={() => capture('region')}>
            Region
          </button>
          <button className="btn" onClick={() => capture('full')}>
            Full screen
          </button>
          <label htmlFor="snap-delay" className="snap-delay-label">
            Delay
          </label>
          <select id="snap-delay" value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
            {DELAYS.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? 'No delay' : `${d} s`}
              </option>
            ))}
          </select>
          <div className="spacer" />
          {hotkey && (
            <span className="muted">
              Anywhere: <kbd>{pretty(hotkey)}</kbd>
            </span>
          )}
        </div>
        {error && <div className="banner error">{error}</div>}
      </section>
      <SnapGallery onOpen={onEdit} />
    </div>
  )
}
