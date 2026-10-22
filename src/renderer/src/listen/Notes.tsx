import { useCallback, useEffect, useRef, useState } from 'react'
import type { NoteEntry } from '../../../shared/listen'
import type { RecordingManifest } from '../../../shared/types'
import { MeetingRecorder } from './meetingRecorder'
import NoteView from './NoteView'

const message = (err: unknown): string =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(err)

const BADGE: Partial<Record<NoteEntry['status'], string>> = {
  recording: 'Recording',
  transcribing: 'Transcribing',
  summarizing: 'Summarising',
  error: 'Failed'
}

/** Notes list, meeting recording and "notes from a Studio recording". Stays mounted while recording. */
export default function Notes({
  open,
  onOpen
}: {
  open: string | null
  onOpen: (id: string | null) => void
}): React.JSX.Element {
  const [items, setItems] = useState<NoteEntry[] | null>(null)
  const [recordings, setRecordings] = useState<RecordingManifest[]>([])
  const [pick, setPick] = useState('')
  const [title, setTitle] = useState('')
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef(new MeetingRecorder())

  const refresh = useCallback(() => {
    window.leverage['notes:list']().then(setItems)
    window.leverage['rec:list']().then((r) =>
      setRecordings(r.filter((m) => m.status !== 'recording' && (m.tracks.mic || m.tracks.system)))
    )
  }, [])

  useEffect(() => {
    refresh()
    const off = window.leverage.on('notes:changed', refresh)
    const offLib = window.leverage.on('library:changed', refresh)
    const offSettings = window.leverage.on('settings:changed', refresh)
    return () => {
      off()
      offLib()
      offSettings()
    }
  }, [refresh])

  useEffect(() => {
    if (!recordingId) return
    const t = window.setInterval(() => setElapsed(recorder.current.elapsedMs), 500)
    return () => window.clearInterval(t)
  }, [recordingId])

  const startMeeting = async (): Promise<void> => {
    setError(null)
    try {
      const note = await recorder.current.start(title)
      setRecordingId(note.id)
      setTitle('')
      onOpen(note.id)
    } catch (err) {
      setError(message(err))
    }
  }
  const stopMeeting = async (): Promise<void> => {
    await recorder.current.stop()
    setRecordingId(null)
  }
  const fromRecording = async (): Promise<void> => {
    setError(null)
    try {
      onOpen((await window.leverage['notes:fromRecording'](pick)).id)
    } catch (err) {
      setError(message(err))
    }
  }

  if (open) {
    return (
      <NoteView
        key={open}
        id={open}
        onBack={() => onOpen(null)}
        recordingMs={open === recordingId ? elapsed : undefined}
        onStop={open === recordingId ? () => void stopMeeting() : undefined}
      />
    )
  }

  return (
    <>
      <section className="card">
        <h2>Record a meeting</h2>
        <p className="muted">
          Records your microphone and your PC’s sound (the other people), then writes a transcript
          and a summary.
        </p>
        {recordingId ? (
          <div className="row">
            <span className="rec-dot" /> Recording · {Math.floor(elapsed / 60000)}:
            {String(Math.floor((elapsed / 1000) % 60)).padStart(2, '0')}
            <button className="btn" onClick={() => onOpen(recordingId)}>
              Open note
            </button>
            <button className="btn primary" onClick={() => void stopMeeting()}>
              Stop and make notes
            </button>
          </div>
        ) : (
          <div className="row">
            <input
              className="text-input grow"
              aria-label="Meeting title"
              placeholder="Meeting title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button className="btn primary" onClick={() => void startMeeting()}>
              Start recording
            </button>
          </div>
        )}
        <h2 className="sub">Or from a Studio recording</h2>
        <div className="row">
          <select
            aria-label="Studio recording"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="grow"
          >
            <option value="">Choose a recording…</option>
            {recordings.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
          <button className="btn" disabled={!pick} onClick={() => void fromRecording()}>
            Make notes
          </button>
        </div>
        {error && <div className="banner error">{error}</div>}
      </section>

      {items && items.length === 0 && <p className="muted">No notes yet.</p>}
      {items?.map((n) => (
        <button
          className="card note-item"
          key={n.id}
          data-testid="note-item"
          onClick={() => onOpen(n.id)}
        >
          <span className="note-item-title">{n.title}</span>
          {BADGE[n.status] && <span className="badge">{BADGE[n.status]}</span>}
          <span className="muted">{new Date(n.createdAt).toLocaleString()}</span>
        </button>
      ))}
    </>
  )
}
