import { useCallback, useEffect, useRef, useState } from 'react'
import type { NoteDoc } from '../../../shared/listen'
import { inline, parseMarkdown } from './markdown'

const message = (err: unknown): string =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(err)

const STATUS: Record<NoteDoc['status'], string> = {
  recording: 'Recording…',
  transcribing: 'Transcribing…',
  summarizing: 'Writing the summary…',
  ready: '',
  error: 'Failed'
}

function Rich({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {inline(text).map((p, i) =>
        p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>
      )}
    </>
  )
}

export function Markdown({ md }: { md: string }): React.JSX.Element {
  return (
    <div className="markdown">
      {parseMarkdown(md).map((b, i) =>
        b.kind === 'heading' ? (
          <h3 key={i}>
            <Rich text={b.text} />
          </h3>
        ) : b.kind === 'paragraph' ? (
          <p key={i}>
            <Rich text={b.text} />
          </p>
        ) : (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j} className={it.task ? 'task' : undefined}>
                {it.task && <input type="checkbox" checked={it.done} readOnly tabIndex={-1} />}
                <Rich text={it.text} />
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}

/** One note: your notes (autosaved), the AI summary, the transcript. */
export default function NoteView({
  id,
  onBack,
  recordingMs,
  onStop
}: {
  id: string
  onBack: () => void
  recordingMs?: number
  onStop?: () => void
}): React.JSX.Element {
  const [doc, setDoc] = useState<NoteDoc | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const saveTimer = useRef(0)
  const dirtyNotes = useRef<string | null>(null)

  const load = useCallback(
    (first = false) =>
      window.leverage['notes:get'](id)
        .then((d) => {
          setDoc(d)
          if (first) {
            setTitle(d.title)
            setNotes(d.notes)
          }
        })
        .catch((err) => setError(message(err))),
    [id]
  )

  useEffect(() => {
    void load(true)
    return window.leverage.on('notes:changed', (c) => {
      if (c.id === id) void load()
    })
  }, [id, load])

  const flushNotes = useCallback(async () => {
    window.clearTimeout(saveTimer.current)
    const pending = dirtyNotes.current
    if (pending === null) return
    dirtyNotes.current = null
    await window.leverage['notes:save'](id, { notes: pending })
  }, [id])
  useEffect(() => () => void flushNotes(), [flushNotes])

  if (!doc)
    return error ? <div className="banner error">{error}</div> : <p className="muted">Loading…</p>

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const working = doc.status === 'transcribing' || doc.status === 'summarizing'
  const canRetry =
    doc.status === 'error' &&
    (doc.source.kind === 'recording' || !!doc.tracks.mic || !!doc.tracks.system)

  return (
    <div className="note" data-testid="note">
      <div className="row">
        <button
          className="btn"
          onClick={async () => {
            await flushNotes()
            onBack()
          }}
        >
          ← Notes
        </button>
        <input
          className="text-input note-title"
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() =>
            title.trim() && title !== doc.title && void window.leverage['notes:save'](id, { title })
          }
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <button
          className="btn"
          onClick={() =>
            window.confirm('Move this note (and its audio) to the Recycle Bin?') &&
            void run(async () => {
              dirtyNotes.current = null
              await window.leverage['notes:delete'](id)
              onBack()
            })
          }
        >
          Delete
        </button>
      </div>
      <div className="muted note-meta">
        {new Date(doc.createdAt).toLocaleString()} ·{' '}
        {doc.source.kind === 'meeting' ? 'Meeting' : `From recording “${doc.source.title}”`}
        {doc.durationMs ? ` · ${Math.round(doc.durationMs / 60000)} min` : ''}
      </div>

      {doc.status === 'recording' && onStop && (
        <div className="card note-recording">
          <span className="rec-dot" /> Recording {Math.floor((recordingMs ?? 0) / 60000)}:
          {String(Math.floor(((recordingMs ?? 0) / 1000) % 60)).padStart(2, '0')}
          <div className="spacer" />
          <button className="btn primary" onClick={onStop}>
            Stop and make notes
          </button>
        </div>
      )}
      {(working || doc.status === 'error') && (
        <div className={doc.status === 'error' ? 'banner error' : 'banner'} role="status">
          {doc.status === 'error' ? `Failed: ${doc.error}` : STATUS[doc.status]}
          {canRetry && (
            <button
              className="btn"
              onClick={() => void run(() => window.leverage['notes:retry'](id))}
            >
              Try again
            </button>
          )}
        </div>
      )}
      {doc.warnings.map((w) => (
        <div className="banner warning" key={w}>
          {w}
        </div>
      ))}
      {error && <div className="banner error">{error}</div>}

      <section className="card">
        <div className="row">
          <h2 className="grow">AI summary</h2>
          {doc.summary && (
            <button
              className="btn"
              onClick={async () => {
                await navigator.clipboard.writeText(doc.summary!)
                setCopied(true)
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
          {!!doc.transcript && (
            <button
              className="btn"
              disabled={busy || working}
              onClick={() => void run(() => window.leverage['notes:summarize'](id))}
            >
              {doc.summary ? 'Regenerate' : 'Summarise'}
            </button>
          )}
        </div>
        {doc.status === 'ready' && doc.error && (
          <div className="banner error">Summary failed: {doc.error}</div>
        )}
        {doc.summary ? (
          <Markdown md={doc.summary} />
        ) : (
          <p className="muted">{working ? STATUS[doc.status] : 'No summary yet.'}</p>
        )}
      </section>

      <section className="card">
        <h2>My notes</h2>
        <textarea
          className="text-input note-notes"
          aria-label="My notes"
          placeholder="Your own notes. The AI uses them to see what matters to you, and never changes them."
          rows={6}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
            dirtyNotes.current = e.target.value
            window.clearTimeout(saveTimer.current)
            saveTimer.current = window.setTimeout(() => void flushNotes(), 600)
          }}
          onBlur={() => void flushNotes()}
        />
      </section>

      <section className="card">
        <details>
          <summary>Transcript</summary>
          {doc.transcript ? (
            <p className="note-transcript">{doc.transcript}</p>
          ) : (
            <p className="muted">No transcript yet.</p>
          )}
        </details>
      </section>
    </div>
  )
}
