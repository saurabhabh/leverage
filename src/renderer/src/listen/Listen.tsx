import { useEffect, useRef, useState } from 'react'
import type { Settings } from '../../../shared/types'
import Dictation from './Dictation'
import Notes from './Notes'
import './listen.css'

type Tab = 'Dictation' | 'Notes'

type Props = { note: string | null; onNote: (id: string | null) => void }

/** Kept mounted by App (like Studio), so a meeting keeps recording while other pages are open. */
export default function Listen({ note, onNote }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('Dictation')
  const [shownNote, setShownNote] = useState<string | null>(null)
  // A note opened from elsewhere (Library → Make notes) switches to the Notes tab.
  if (note !== shownNote) {
    setShownNote(note)
    if (note) setTab('Notes')
  }
  const [settings, setSettings] = useState<Settings | null>(null)
  // Saves in flight: until the last one lands, replies to earlier saves are stale and ignored.
  const pending = useRef(0)

  useEffect(() => {
    window.leverage['settings:get']().then(setSettings)
    return window.leverage.on('settings:changed', (s) => {
      if (!pending.current) setSettings(s)
    })
  }, [])

  if (!settings) return <p className="muted">Loading…</p>
  const update = (s: Settings): void => {
    setSettings(s)
    pending.current++
    window.leverage['settings:set'](s).then(
      (saved) => {
        if (--pending.current === 0) setSettings(saved)
      },
      () => pending.current--
    )
  }

  return (
    <div className="page listen">
      <h1>Listen</h1>
      <div className="tabs" role="tablist">
        {(['Dictation', 'Notes'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'tab active' : 'tab'}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div hidden={tab !== 'Dictation'}>
        <Dictation settings={settings} update={update} />
      </div>
      <div hidden={tab !== 'Notes'}>
        <Notes open={note} onOpen={onNote} />
      </div>
    </div>
  )
}
