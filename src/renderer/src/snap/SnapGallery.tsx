import { useCallback, useEffect, useState } from 'react'
import type { SnapEntry } from '../../../shared/snap'

/** Newest-first thumbnails of every shot in the Snap folder. Used by Snap and Library. */
export default function SnapGallery({
  onOpen
}: {
  onOpen: (id: string) => void
}): React.JSX.Element {
  const [items, setItems] = useState<SnapEntry[] | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  const refresh = useCallback(() => {
    window.leverage['snap:list']().then(setItems)
  }, [])

  useEffect(() => {
    refresh()
    const offChanged = window.leverage.on('snap:changed', refresh)
    const offSettings = window.leverage.on('settings:changed', refresh)
    return () => {
      offChanged()
      offSettings()
    }
  }, [refresh])

  // Thumbnails are the rendered PNGs; reload them whenever the list changes (an edit re-renders).
  useEffect(() => {
    if (!items) return
    let alive = true
    const made: string[] = []
    void (async () => {
      for (const item of items) {
        try {
          const png = await window.leverage['snap:image'](item.id, 'rendered')
          const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
          made.push(url)
          if (alive) setThumbs((t) => ({ ...t, [item.id]: url }))
        } catch {
          // Deleted in Explorer since the list was read; the next refresh drops it.
        }
      }
    })()
    return () => {
      alive = false
      made.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [items])

  if (!items) return <p className="muted">Loading…</p>
  if (items.length === 0) return <p className="muted">No screenshots yet.</p>

  return (
    <div className="snap-grid">
      {items.map((s) => (
        <div className="snap-tile" key={s.id} data-testid="snap-tile">
          <button className="snap-thumb" onClick={() => onOpen(s.id)} title="Open in the editor">
            {thumbs[s.id] ? (
              <img src={thumbs[s.id]} alt={s.id} />
            ) : (
              <span className="muted">…</span>
            )}
          </button>
          <div className="snap-meta">
            <span>{new Date(s.createdAt).toLocaleString()}</span>
            <span className="muted">
              {s.width} × {s.height}
            </span>
          </div>
          <div className="snap-tile-actions">
            <button className="btn" onClick={() => window.leverage['snap:copy'](s.id)}>
              Copy
            </button>
            <button className="btn" onClick={() => window.leverage['snap:pin'](s.id)}>
              Pin
            </button>
            <button
              className="btn"
              onClick={() => {
                if (window.confirm('Move this screenshot to the Recycle Bin?'))
                  void window.leverage['snap:delete'](s.id)
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
