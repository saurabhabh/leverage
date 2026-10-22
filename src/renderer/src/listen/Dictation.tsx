import { useCallback, useEffect, useState } from 'react'
import type { DictationEntry, DictationStatus } from '../../../shared/listen'
import type { Settings } from '../../../shared/types'

const pretty = (accelerator: string): string => accelerator.replace('CommandOrControl', 'Ctrl')
const message = (err: unknown): string =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(err)

const PHASE_LABEL: Record<DictationStatus['phase'], string> = {
  idle: 'Ready',
  recording: 'Listening…',
  transcribing: 'Transcribing…',
  done: 'Done',
  error: 'Something went wrong'
}

/** Dictation: how to use it, its options and dictionary, and the history of what was dictated. */
export default function Dictation({
  settings,
  update
}: {
  settings: Settings
  update: (s: Settings) => void
}): React.JSX.Element {
  const [status, setStatus] = useState<DictationStatus>({ phase: 'idle' })
  const [items, setItems] = useState<DictationEntry[] | null>(null)
  const [keys, setKeys] = useState({ groq: false, openrouter: false })
  const [word, setWord] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    window.leverage['dictate:history']().then(setItems)
  }, [])

  useEffect(() => {
    refresh()
    window.leverage['dictate:current']().then(setStatus)
    window.leverage['ai:hasKeys']().then(setKeys)
    const offStatus = window.leverage.on('dictate:status', setStatus)
    const offHistory = window.leverage.on('dictate:historyChanged', refresh)
    return () => {
      offStatus()
      offHistory()
    }
  }, [refresh])

  const listen = settings.listen
  const setListen = (patch: Partial<Settings['listen']>): void =>
    update({ ...settings, listen: { ...listen, ...patch } })
  const provider = settings.ai.suggestions
  const providerName = provider === 'groq' ? 'Groq' : 'OpenRouter'
  const engineName = settings.ai.transcription === 'local' ? 'local Whisper (on this PC)' : 'Groq'

  const addWord = (): void => {
    const w = word.trim()
    if (w && !listen.dictionary.some((d) => d.toLowerCase() === w.toLowerCase()))
      setListen({ dictionary: [...listen.dictionary, w] })
    setWord('')
  }

  const retry = async (id: string): Promise<void> => {
    setError(null)
    try {
      await window.leverage['dictate:retry'](id)
    } catch (err) {
      setError(message(err))
    }
  }

  return (
    <>
      <section className="card">
        <div className="row">
          <button
            className="btn primary"
            onClick={() => void window.leverage['dictate:toggle']()}
            disabled={status.phase === 'transcribing'}
          >
            {status.phase === 'recording' ? 'Stop and paste' : 'Start dictation'}
          </button>
          <span className="muted" role="status" data-testid="dictate-status">
            {status.phase === 'done' || status.phase === 'error'
              ? (status.message ?? PHASE_LABEL[status.phase])
              : PHASE_LABEL[status.phase]}
          </span>
          <div className="spacer" />
          <span className="muted">
            Anywhere: <kbd>{pretty(listen.hotkey)}</kbd> to start, again to paste · <kbd>Esc</kbd>{' '}
            cancels
          </span>
        </div>
        <textarea
          className="text-input listen-try"
          aria-label="Try it here"
          placeholder="Click here, then dictate to try it."
          rows={3}
        />
      </section>

      <section className="card">
        <h2>Options</h2>
        <div className="row">
          <label htmlFor="listen-paste">Paste into the app I’m typing in</label>
          <input
            id="listen-paste"
            type="checkbox"
            checked={listen.paste}
            onChange={(e) => setListen({ paste: e.target.checked })}
          />
          <span className="muted">
            {listen.paste ? '' : 'Off: the text is copied; press Ctrl+V yourself.'}
          </span>
        </div>
        <div className="row">
          <label htmlFor="listen-cleanup">
            Clean up with AI (fillers, punctuation, self-corrections)
          </label>
          <input
            id="listen-cleanup"
            type="checkbox"
            checked={listen.cleanup}
            onChange={(e) => setListen({ cleanup: e.target.checked })}
          />
          <span className="muted">
            {listen.cleanup && !keys[provider]
              ? `Add a ${providerName} key in Settings to turn this on.`
              : `Uses ${providerName}; only the text is sent.`}
          </span>
        </div>
        <div className="row">
          <label>Speech to text</label>
          <span className="muted">{engineName} — change in Settings</span>
        </div>
      </section>

      <section className="card">
        <h2>Dictionary</h2>
        <p className="muted">Names and terms Whisper should spell your way.</p>
        <div className="chips">
          {listen.dictionary.map((w) => (
            <span className="chip" key={w}>
              {w}
              <button
                aria-label={`Remove ${w}`}
                onClick={() => setListen({ dictionary: listen.dictionary.filter((d) => d !== w) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="row">
          <input
            className="text-input"
            aria-label="New dictionary word"
            placeholder="Add a word or name"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addWord()}
          />
          <button className="btn" onClick={addWord}>
            Add
          </button>
        </div>
      </section>

      <section className="card">
        <div className="row">
          <h2 className="grow">History</h2>
          {!!items?.length && (
            <button
              className="btn"
              onClick={() =>
                window.confirm('Clear the whole dictation history?') &&
                void window.leverage['dictate:clear']()
              }
            >
              Clear all
            </button>
          )}
        </div>
        {error && <div className="banner error">{error}</div>}
        {items && items.length === 0 && <p className="muted">Nothing dictated yet.</p>}
        {items?.map((d) => (
          <div className="dictation" key={d.id} data-testid="dictation">
            <div className="dictation-meta muted">
              {new Date(d.createdAt).toLocaleString()} · {(d.durationMs / 1000).toFixed(1)} s
              {d.cleaned && <span className="badge">Cleaned up</span>}
              {!d.error && !d.pasted && <span className="badge">Copied</span>}
            </div>
            {d.error ? (
              <div className="banner error">{d.error}</div>
            ) : (
              <div className="dictation-text">{d.text}</div>
            )}
            <div className="dictation-actions">
              {d.text && (
                <button className="btn" onClick={() => void window.leverage['dictate:copy'](d.id)}>
                  Copy
                </button>
              )}
              {d.error && d.audio && (
                <button className="btn primary" onClick={() => void retry(d.id)}>
                  Retry
                </button>
              )}
              <button className="btn" onClick={() => void window.leverage['dictate:remove'](d.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </section>
    </>
  )
}
