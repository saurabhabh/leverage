import { useState } from 'react'
import { cleanError } from './TranscriptPanel'

type Result = { count: number; seconds: number }

type Props = {
  /** Why pauses can't be found (no audio), or null. */
  noAudio: string | null
  hasTranscript: boolean
  onRemovePauses: () => Promise<Result>
  onRemoveFillers: () => Result
  children?: React.ReactNode
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** One-click cleanups. Each applies as a single undo step. */
export default function AutoCuts(p: Props): React.JSX.Element {
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const pauses = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await p.onRemovePauses()
      setMessage({ text: r.count ? `Removed ${plural(r.count, 'pause')} (${r.seconds.toFixed(1)} s)` : 'No long pauses found' })
    } catch (err) {
      setMessage({ text: cleanError(err), error: true })
    } finally {
      setBusy(false)
    }
  }

  const fillers = (): void => {
    const r = p.onRemoveFillers()
    setMessage({ text: r.count ? `Removed ${plural(r.count, 'filler word')} (${r.seconds.toFixed(1)} s)` : 'No filler words found' })
  }

  return (
    <div className="autocuts">
      <strong>Clean up</strong>
      <div className="transcript-actions">
        <button className="btn" onClick={pauses} disabled={!!p.noAudio || busy} title={p.noAudio ?? 'Cut pauses longer than 1 second'}>
          Remove pauses
        </button>
        <button
          className="btn"
          onClick={fillers}
          disabled={!p.hasTranscript}
          title={p.hasTranscript ? 'Cut um, uh, hmm…' : 'Transcribe first'}
        >
          Remove filler words
        </button>
      </div>
      {message && (
        <div className={message.error ? 'banner error' : 'muted'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </div>
      )}
      {p.children}
    </div>
  )
}
