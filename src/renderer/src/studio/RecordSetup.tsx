import { useCallback, useEffect, useState } from 'react'
import type { CaptureSource } from '../../../shared/types'

export type RecordChoice = {
  source: CaptureSource
  cameraId?: string
  micId?: string
  systemAudio: boolean
}

type Tab = 'screen' | 'window'
type Prefs = { tab: Tab; sourceId?: string; cameraId?: string; micId?: string; systemAudio: boolean }

const PREFS_KEY = 'studio.recordPrefs'
const OFF = ''

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) return { tab: 'screen', systemAudio: true, ...JSON.parse(raw) }
  } catch {
    // Storage unavailable — fall back to defaults.
  }
  return { tab: 'screen', systemAudio: true }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    // Non-essential.
  }
}

type Props = {
  busy: boolean
  onRecord: (choice: RecordChoice) => void
  onRegion?: (choice: Omit<RecordChoice, 'source'>) => void
  /** Current selection, so a hotkey can start recording without clicking Record. */
  onChoiceChange?: (choice: RecordChoice | null) => void
}

export default function RecordSetup({ busy, onRecord, onRegion, onChoiceChange }: Props): React.JSX.Element {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [loading, setLoading] = useState(true)

  const update = (patch: Partial<Prefs>): void => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSources(await window.leverage['capture:list']())
      setDevices(await navigator.mediaDevices.enumerateDevices())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [refresh])

  const cameras = devices.filter((d) => d.kind === 'videoinput')
  const mics = devices.filter((d) => d.kind === 'audioinput')
  const shown = sources.filter((s) => s.kind === prefs.tab)
  const selected = sources.find((s) => s.id === prefs.sourceId) ?? shown[0]
  const deviceChoice = {
    cameraId: cameras.some((c) => c.deviceId === prefs.cameraId) ? prefs.cameraId : undefined,
    micId: mics.some((m) => m.deviceId === prefs.micId) ? prefs.micId : undefined,
    systemAudio: prefs.systemAudio
  }

  const choiceKey = JSON.stringify([selected?.id, deviceChoice])
  useEffect(() => {
    onChoiceChange?.(selected ? { source: selected, ...deviceChoice } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choiceKey])

  return (
    <div className="page record-setup">
      <h1>New recording</h1>

      <section className="card">
        <div className="tabs" role="tablist">
          {(['screen', 'window'] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={prefs.tab === t}
              className={prefs.tab === t ? 'tab active' : 'tab'}
              onClick={() => update({ tab: t, sourceId: undefined })}
            >
              {t === 'screen' ? 'Screens' : 'Windows'}
            </button>
          ))}
          <button
            className="tab"
            disabled={!onRegion || busy}
            onClick={() => onRegion?.(deviceChoice)}
            title="Draw the area of a screen to record"
          >
            Region…
          </button>
          <span className="spacer" />
          <button className="btn" onClick={refresh} disabled={loading}>
            Refresh
          </button>
        </div>

        <div className="source-grid">
          {shown.map((s) => (
            <button
              key={s.id}
              className={s.id === selected?.id ? 'source selected' : 'source'}
              onClick={() => update({ sourceId: s.id })}
              aria-pressed={s.id === selected?.id}
            >
              <img src={s.thumbnailDataUrl} alt="" />
              <span>{s.name}</span>
            </button>
          ))}
          {!loading && shown.length === 0 && <p className="muted">Nothing to show.</p>}
        </div>
      </section>

      <section className="card">
        <div className="row">
          <label htmlFor="camera">Camera</label>
          <select
            id="camera"
            value={deviceChoice.cameraId ?? OFF}
            onChange={(e) => update({ cameraId: e.target.value || undefined })}
          >
            <option value={OFF}>Off</option>
            {cameras.map((c, i) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label htmlFor="mic">Microphone</label>
          <select
            id="mic"
            value={deviceChoice.micId ?? OFF}
            onChange={(e) => update({ micId: e.target.value || undefined })}
          >
            <option value={OFF}>Off</option>
            {mics.map((m, i) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label htmlFor="system-audio">System audio</label>
          <input
            id="system-audio"
            type="checkbox"
            checked={prefs.systemAudio}
            onChange={(e) => update({ systemAudio: e.target.checked })}
          />
        </div>
      </section>

      <button
        className="btn primary record-btn"
        disabled={!selected || busy}
        onClick={() => selected && onRecord({ source: selected, ...deviceChoice })}
      >
        ● Record
      </button>
    </div>
  )
}
