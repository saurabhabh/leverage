import { useEffect, useState } from 'react'
import type { OpenedEdit } from '../../../shared/ipc'
import type { TrackKind } from '../../../shared/types'
import './editor.css'

type Props = { recordingId: string; onBack: () => void }

export default function Editor({ recordingId, onBack }: Props): React.JSX.Element {
  const [opened, setOpened] = useState<OpenedEdit | null>(null)
  const [urls, setUrls] = useState<Partial<Record<TrackKind, string>>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const o = await window.leverage['edit:open'](recordingId)
        const entries = await Promise.all(
          (Object.keys(o.manifest.tracks) as TrackKind[]).map(
            async (k) => [k, await window.leverage['edit:mediaUrl'](recordingId, k)] as const
          )
        )
        if (cancelled) return
        setUrls(Object.fromEntries(entries))
        setOpened(o)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [recordingId])

  return (
    <div className="editor">
      <div className="editor-top">
        <button className="btn" onClick={onBack}>
          ← Library
        </button>
        <h1>{opened?.manifest.title ?? 'Opening…'}</h1>
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {opened?.repaired && (
        <div className="banner warning" role="status">
          This recording&apos;s saved edits could not be read completely, so some were reset.
        </div>
      )}
      {opened && urls.screen && (
        <div className="preview-frame">
          <video data-testid="preview-screen" src={urls.screen} preload="auto" muted />
        </div>
      )}
    </div>
  )
}
