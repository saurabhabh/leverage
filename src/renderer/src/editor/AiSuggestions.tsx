import { useState } from 'react'
import type { Word } from '../../../shared/transcript'
import { cleanError } from './TranscriptPanel'

type Cut = { from: number; to: number; reason: string; startMs: number; endMs: number }

type Props = {
  recordingId: string
  words: Word[]
  /** Apply these cuts as one undo step. */
  onApply: (cuts: Cut[]) => void
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Ask the AI for retakes/rambles to cut; nothing changes until the user applies a suggestion. */
export default function AiSuggestions({ recordingId, words, onApply }: Props): React.JSX.Element {
  const [cuts, setCuts] = useState<Cut[] | null>(null)
  const [dropped, setDropped] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minutes, setMinutes] = useState('')

  const ask = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const target = Number(minutes)
      const r = await window.leverage['ai:suggestCuts'](recordingId, minutes && target > 0 ? target * 60 : undefined)
      setCuts(r.cuts)
      setDropped(r.dropped)
    } catch (err) {
      setError(cleanError(err))
      setCuts(null)
    } finally {
      setBusy(false)
    }
  }

  const apply = (list: Cut[]): void => {
    onApply(list)
    setCuts((cs) => (cs ? cs.filter((c) => !list.includes(c)) : cs))
  }

  return (
    <div className="ai-suggestions">
      <div className="transcript-actions">
        <button className="btn" onClick={ask} disabled={busy || words.length === 0} title={words.length ? '' : 'Transcribe first'}>
          {busy ? 'Thinking…' : 'Suggest cuts with AI'}
        </button>
        <label className="target">
          Target
          <input
            type="number"
            min={1}
            placeholder="min"
            aria-label="Target length in minutes"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {cuts && cuts.length === 0 && <div className="muted">No cuts suggested.</div>}
      {dropped > 0 && <div className="muted">{plural(dropped, 'suggestion')} couldn&apos;t be used</div>}
      {cuts && cuts.length > 0 && (
        <>
          <ul className="suggestions">
            {cuts.map((c) => (
              <li key={`${c.from}-${c.to}`} data-testid="suggestion" className="suggestion">
                <div>
                  <strong>{c.reason || 'Suggested cut'}</strong>
                  <div className="muted suggestion-words">
                    {words
                      .slice(c.from, c.to + 1)
                      .map((w) => w.text)
                      .join(' ')}
                  </div>
                </div>
                <div className="suggestion-buttons">
                  <button className="btn" onClick={() => apply([c])}>
                    Apply
                  </button>
                  <button className="btn" onClick={() => setCuts((cs) => cs!.filter((x) => x !== c))}>
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button className="btn primary" onClick={() => apply(cuts)}>
            Apply all ({cuts.length})
          </button>
        </>
      )}
    </div>
  )
}
