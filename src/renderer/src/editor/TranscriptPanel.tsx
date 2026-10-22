import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditDoc } from '../../../shared/edit'
import { flaggedPhrases, wordAtSource, wordStates, type Transcript } from '../../../shared/transcript'

export type WordSelection = { from: number; to: number } | null

type Props = {
  recordingId: string
  edit: EditDoc
  transcript: Transcript | null
  onTranscript: (t: Transcript) => void
  /** Why transcription is impossible for this recording, or null if it is possible. */
  unavailable: string | null
  srcMs: number
  selection: WordSelection
  onSelect: (sel: WordSelection) => void
  onSeekWord: (index: number) => void
  onCutSelected: () => void
  children?: React.ReactNode
}

type Status =
  | { kind: 'idle' }
  | { kind: 'confirm-install' }
  | { kind: 'installing'; stage: string; pct: number }
  | { kind: 'transcribing'; stage: string; pct: number }
  | { kind: 'error'; message: string }

/** Electron prefixes errors from the main process; show only the meaningful part. */
export const cleanError = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')

export default function TranscriptPanel(p: Props): React.JSX.Element {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    const offT = window.leverage.on('transcribe:progress', ({ id, stage, pct }) => {
      if (id === p.recordingId) setStatus((s) => (s.kind === 'transcribing' ? { kind: 'transcribing', stage, pct } : s))
    })
    const offW = window.leverage.on('whisper:progress', ({ stage, pct }) =>
      setStatus((s) =>
        s.kind === 'installing' ? { kind: 'installing', stage: stage === 'engine' ? 'Speech engine' : 'Speech model', pct } : s
      )
    )
    return () => {
      offT()
      offW()
    }
  }, [p.recordingId])

  const transcribe = async (): Promise<void> => {
    setStatus({ kind: 'transcribing', stage: 'Starting', pct: 0 })
    try {
      p.onTranscript(await window.leverage['transcribe:run'](p.recordingId))
      setStatus({ kind: 'idle' })
    } catch (err) {
      const message = cleanError(err)
      if (message.includes('NEEDS_INSTALL')) setStatus({ kind: 'confirm-install' })
      else if (/cancelled/i.test(message)) setStatus({ kind: 'idle' })
      else setStatus({ kind: 'error', message })
    }
  }

  const install = async (): Promise<void> => {
    setStatus({ kind: 'installing', stage: 'Speech engine', pct: 0 })
    try {
      await window.leverage['whisper:install']()
      await transcribe()
    } catch (err) {
      const message = cleanError(err)
      setStatus(/cancel/i.test(message) ? { kind: 'idle' } : { kind: 'error', message })
    }
  }

  const words = p.transcript?.words ?? []
  const flagged = useMemo(() => {
    const set = new Set<number>()
    for (const i of flaggedPhrases(words)) {
      set.add(i)
      set.add(i + 1)
    }
    return set
  }, [words])
  const current = wordAtSource(words, p.srcMs)
  const sel = p.selection

  // The word list only re-renders when the edit, words or selection change — not on every playback
  // frame. Callbacks are read through a ref so their identity doesn't invalidate the memo.
  const states = useMemo(() => wordStates(p.edit, words), [p.edit, words])
  const latest = useRef(p)
  latest.current = p
  const wordSpans = useMemo(
    () =>
      words.map((w, i) => {
        const selected = sel !== null && i >= sel.from && i <= sel.to
        const cls = ['word', states[i], selected && 'selected', flagged.has(i) && 'flagged'].filter(Boolean).join(' ')
        return (
          <span key={i}>
            <span
              data-testid="word"
              data-index={i}
              data-state={states[i]}
              data-flagged={flagged.has(i) ? 'true' : undefined}
              className={cls}
              title={flagged.has(i) ? 'Often a filler phrase — cut it if it adds nothing' : undefined}
              onClick={(e) => {
                const { selection, onSelect, onSeekWord } = latest.current
                if (e.shiftKey && selection) onSelect({ from: Math.min(selection.from, i), to: Math.max(selection.to, i) })
                else {
                  onSelect({ from: i, to: i })
                  onSeekWord(i)
                }
              }}
            >
              {w.text}
            </span>{' '}
          </span>
        )
      }),
    [words, states, sel, flagged]
  )

  // The playing word is highlighted directly on the DOM, so playback doesn't re-render the list.
  const list = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const el = list.current
    if (!el) return
    el.querySelector('.word.current')?.classList.remove('current')
    if (current >= 0) el.querySelector(`[data-index="${current}"]`)?.classList.add('current')
  }, [current, wordSpans])
  const busy = status.kind === 'transcribing' || status.kind === 'installing'

  return (
    <div className="transcript-panel">
      <div className="transcript-actions">
        <button className="btn primary" onClick={transcribe} disabled={!!p.unavailable || busy}>
          {p.transcript ? 'Re-transcribe' : 'Transcribe'}
        </button>
        {sel && (
          <button className="btn" onClick={p.onCutSelected}>
            Cut selected words
          </button>
        )}
      </div>
      {p.unavailable && <p className="muted">{p.unavailable}</p>}

      {busy && (
        <div className="transcript-busy">
          <span className="muted">
            {status.stage} {status.pct > 0 && `${status.pct}%`}
          </span>
          <div className="progress" role="progressbar" aria-valuenow={status.pct}>
            <div style={{ width: `${status.pct}%` }} />
          </div>
          <button
            className="btn"
            onClick={() =>
              void (status.kind === 'installing'
                ? window.leverage['whisper:cancel']()
                : window.leverage['transcribe:cancel'](p.recordingId))
            }
          >
            Cancel
          </button>
        </div>
      )}

      {status.kind === 'error' && (
        <div className="banner error" role="alert">
          {status.message}
        </div>
      )}

      {status.kind === 'confirm-install' && (
        <div className="dialog-backdrop">
          <div className="dialog card" role="dialog" aria-modal="true" aria-label="Download speech engine">
            <strong>Set up local transcription</strong>
            <p>
              Download the speech engine (22 MB) and model (148 MB) once? They stay on this PC, and your audio never
              leaves it.
            </p>
            <div className="dialog-buttons">
              <button className="btn" onClick={() => setStatus({ kind: 'idle' })}>
                Cancel
              </button>
              <button className="btn primary" onClick={install}>
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      {p.transcript && words.length === 0 && (
        <p className="muted">No speech found in the {p.transcript.track === 'mic' ? 'microphone' : 'system audio'} track.</p>
      )}

      {words.length > 0 && (
        <p className="transcript-words" aria-label="Transcript" ref={list}>
          {wordSpans}
        </p>
      )}
      {p.children}
    </div>
  )
}
