import { useCallback, useEffect, useState } from 'react'
import type { RecordingManifest, TrackKind } from '../../../shared/types'

const TRACK_LABEL: Record<TrackKind, string> = { screen: 'Screen', camera: 'Camera', mic: 'Mic', system: 'System audio' }

const duration = (ms: number): string => {
  if (!ms) return '—'
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type Job = { kind: 'mp4' | 'gif'; pct: number } | { done: string } | { error: string }

export default function Library(): React.JSX.Element {
  const [items, setItems] = useState<RecordingManifest[] | null>(null)
  const [jobs, setJobs] = useState<Record<string, Job>>({})

  const refresh = useCallback(() => {
    window.leverage['rec:list']().then(setItems)
  }, [])

  useEffect(() => {
    refresh()
    const offLib = window.leverage.on('library:changed', refresh)
    const offSettings = window.leverage.on('settings:changed', refresh)
    const offProgress = window.leverage.on('export:progress', ({ id, pct }) =>
      setJobs((j) => {
        const job = j[id]
        return job && 'kind' in job ? { ...j, [id]: { ...job, pct } } : j
      })
    )
    return () => {
      offLib()
      offSettings()
      offProgress()
    }
  }, [refresh])

  const exportAs = async (id: string, kind: 'mp4' | 'gif'): Promise<void> => {
    setJobs((j) => ({ ...j, [id]: { kind, pct: 0 } }))
    try {
      const out = await window.leverage[kind === 'mp4' ? 'export:mp4' : 'export:gif'](id)
      setJobs((j) => {
        const next = { ...j }
        if (out) next[id] = { done: out }
        else delete next[id]
        return next
      })
    } catch (err) {
      setJobs((j) => ({ ...j, [id]: { error: err instanceof Error ? err.message.split('\n')[0] : String(err) } }))
    }
  }

  const showInFolder = async (m: RecordingManifest): Promise<void> => {
    const job = jobs[m.id]
    if (job && 'done' in job) return window.leverage['shell:showInFolder'](job.done)
    const dir = await window.leverage['rec:dir'](m.id)
    const screen = m.tracks.screen
    if (dir) await window.leverage['shell:showInFolder'](screen ? `${dir}\\${screen.file}` : dir)
  }

  const remove = async (m: RecordingManifest): Promise<void> => {
    if (!window.confirm(`Move "${m.title}" to the Recycle Bin?`)) return
    await window.leverage['rec:delete'](m.id)
  }

  if (!items) return <p className="muted">Loading…</p>

  return (
    <div className="page library">
      <h1>Library</h1>
      {items.length === 0 && <p className="muted">No recordings yet. Make one in Studio.</p>}
      {items.map((m) => {
        const job = jobs[m.id]
        const busy = !!job && 'kind' in job
        return (
          <section className="card library-item" key={m.id} data-testid="library-item">
            <div className="library-head">
              <div>
                <div className="library-title">
                  {m.title}
                  {m.status === 'incomplete' && (
                    <span className="badge" title="Leverage closed before this recording was stopped. What was captured is kept.">
                      Incomplete
                    </span>
                  )}
                </div>
                <div className="muted">
                  {new Date(m.createdAt).toLocaleString()} · {duration(m.durationMs)} ·{' '}
                  {(Object.keys(m.tracks) as TrackKind[]).map((k) => TRACK_LABEL[k]).join(', ')}
                </div>
              </div>
              <div className="library-actions">
                <button className="btn primary" disabled={busy || !m.tracks.screen} onClick={() => exportAs(m.id, 'mp4')}>
                  Export MP4
                </button>
                <button className="btn" disabled={busy || !m.tracks.screen} onClick={() => exportAs(m.id, 'gif')}>
                  Export GIF
                </button>
                <button className="btn" onClick={() => showInFolder(m)}>
                  Show in Explorer
                </button>
                <button className="btn" disabled={busy} onClick={() => remove(m)}>
                  Delete
                </button>
              </div>
            </div>
            {job && 'kind' in job && (
              <div className="progress" role="progressbar" aria-valuenow={job.pct} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${job.pct}%` }} />
              </div>
            )}
            {job && 'done' in job && <div className="muted">Saved to {job.done}</div>}
            {job && 'error' in job && <div className="banner error">Export failed: {job.error}</div>}
          </section>
        )
      })}
    </div>
  )
}
