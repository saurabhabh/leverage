import { useEffect, useState } from 'react'
import type { Settings as SettingsT } from '../../../shared/types'
import AiSettings from './AiSettings'

const HOTKEY_LABELS: Record<keyof SettingsT['hotkeys'], string> = {
  toggle: 'Start / stop recording',
  pause: 'Pause / resume',
  abort: 'Abort recording'
}

const pretty = (accelerator: string): string => accelerator.replace('CommandOrControl', 'Ctrl')

export default function Settings(): React.JSX.Element {
  const [settings, setSettings] = useState<SettingsT | null>(null)
  const [failedHotkeys, setFailedHotkeys] = useState<string[]>([])

  useEffect(() => {
    const load = (s: SettingsT): void => {
      setSettings(s)
      window.leverage['hotkeys:failed']().then(setFailedHotkeys)
    }
    window.leverage['settings:get']().then(load)
    return window.leverage.on('settings:changed', load)
  }, [])

  if (!settings) return <p className="muted">Loading…</p>

  const update = (patch: Partial<SettingsT>): void => {
    window.leverage['settings:set']({ ...settings, ...patch }).then(setSettings)
  }

  const pickFolder = async (): Promise<void> => {
    const folder = await window.leverage['dialog:pickFolder'](settings.libraryDir)
    if (folder) update({ libraryDir: folder })
  }

  const pickSnapFolder = async (): Promise<void> => {
    const folder = await window.leverage['dialog:pickFolder'](settings.snap.dir)
    if (folder) update({ snap: { ...settings.snap, dir: folder } })
  }

  return (
    <div className="page">
      <h1>Settings</h1>

      <section className="card">
        <h2>Recordings</h2>
        <div className="row">
          <label>Library folder</label>
          <code className="path" data-testid="library-dir">
            {settings.libraryDir}
          </code>
          <button className="btn" onClick={pickFolder}>
            Change…
          </button>
        </div>
        <div className="row">
          <label htmlFor="countdown">Countdown (seconds)</label>
          <input
            id="countdown"
            type="number"
            min={0}
            max={10}
            value={settings.countdownSec}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isInteger(n) && n >= 0 && n <= 10) update({ countdownSec: n })
            }}
          />
        </div>
        <div className="row">
          <label htmlFor="confirm-abort">Ask before aborting a recording</label>
          <input
            id="confirm-abort"
            type="checkbox"
            checked={settings.confirmAbort}
            onChange={(e) => update({ confirmAbort: e.target.checked })}
          />
        </div>
      </section>

      <section className="card">
        <h2>Screenshots</h2>
        <div className="row">
          <label>Screenshots folder</label>
          <code className="path" data-testid="snap-dir">
            {settings.snap.dir}
          </code>
          <button className="btn" onClick={pickSnapFolder}>
            Change…
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Hotkeys</h2>
        <p className="muted">These work from any app while Leverage is running.</p>
        {failedHotkeys.length > 0 && (
          <div className="banner warning" role="alert">
            {failedHotkeys.map(pretty).join(', ')} could not be registered — another app may already use{' '}
            {failedHotkeys.length > 1 ? 'them' : 'it'}.
          </div>
        )}
        {(Object.keys(HOTKEY_LABELS) as (keyof SettingsT['hotkeys'])[]).map((k) => (
          <div className="row" key={k}>
            <label>{HOTKEY_LABELS[k]}</label>
            <kbd>{pretty(settings.hotkeys[k])}</kbd>
          </div>
        ))}
        <div className="row">
          <label>Take a screenshot</label>
          <kbd>{pretty(settings.snap.hotkey)}</kbd>
        </div>
        <div className="row">
          <label>Dictate (press again to paste)</label>
          <kbd>{pretty(settings.listen.hotkey)}</kbd>
        </div>
      </section>

      <AiSettings settings={settings} update={update} />
    </div>
  )
}
