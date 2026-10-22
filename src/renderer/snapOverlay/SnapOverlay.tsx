import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeDrag } from '../../shared/region'
import { handleAt, isArrowKey, nudge, resizeBy, type Handle } from '../../shared/selection'
import type { SnapAction } from '../../shared/snap'
import type { Rect } from '../../shared/types'

const MIN_SIZE = 5
const GRAB = 8
const params = new URLSearchParams(location.search)
const displayId = params.get('displayId') ?? ''
const bounds = {
  width: Number(params.get('w') ?? innerWidth),
  height: Number(params.get('h') ?? innerHeight)
}
const origin = { x: Number(params.get('x') ?? 0), y: Number(params.get('y') ?? 0) }

type Point = { x: number; y: number }
type Drag = { handle: Handle | 'new'; start: Point; startRect: Rect | null }

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  move: 'move'
}
const HANDLES: Exclude<Handle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/**
 * Frozen screen of one display. Drag to select, then adjust with handles or the keyboard
 * (Flameshot's controls). Enter edits, Ctrl+C copies, Ctrl+S saves, Esc / right-click cancels.
 */
export default function SnapOverlay(): React.JSX.Element {
  const [image, setImage] = useState<string | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [cursor, setCursor] = useState('crosshair')
  // A ref, not state: mousemove/mouseup can arrive before React re-renders after mousedown.
  const drag = useRef<Drag | null>(null)

  useEffect(() => {
    let url = ''
    window.leverage['snap:frozen'](displayId).then(async (png) => {
      url = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
      const img = new Image()
      img.src = url
      await img.decode()
      setImage(url)
      requestAnimationFrame(() => void window.leverage['snap:ready']())
    })
    return () => URL.revokeObjectURL(url)
  }, [])

  const submit = useCallback(
    (action: SnapAction | null) => {
      if (action && !rect) return
      void window.leverage['snap:select'](
        action && rect
          ? {
              displayId,
              action,
              rectDip: {
                x: rect.x + origin.x,
                y: rect.y + origin.y,
                width: rect.width,
                height: rect.height
              }
            }
          : null
      )
    },
    [rect]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ctrl = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') submit(null)
      else if (e.key === 'Enter') submit('edit')
      else if (ctrl && e.key.toLowerCase() === 'c') submit('copy')
      else if (ctrl && e.key.toLowerCase() === 's') submit('save')
      else if (ctrl && e.key.toLowerCase() === 'a') setRect({ x: 0, y: 0, ...bounds })
      else if (isArrowKey(e.key) && rect)
        setRect(nudge(rect, e.key, { shift: e.shiftKey, ctrl }, bounds))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rect, submit])

  const point = (e: React.MouseEvent): Point => ({ x: e.clientX, y: e.clientY })

  return (
    <div
      className="snap-overlay"
      style={{ cursor, backgroundImage: image ? `url(${image})` : undefined }}
      onContextMenu={(e) => {
        e.preventDefault()
        submit(null)
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const p = point(e)
        const handle = rect ? handleAt(rect, p, GRAB) : null
        drag.current = handle
          ? { handle, start: p, startRect: rect }
          : { handle: 'new', start: p, startRect: null }
        if (!handle) setRect(null)
      }}
      onMouseMove={(e) => {
        const p = point(e)
        const d = drag.current
        if (!d) {
          const handle = rect ? handleAt(rect, p, GRAB) : null
          setCursor(handle ? CURSORS[handle] : 'crosshair')
          return
        }
        if (d.handle === 'new') setRect(normalizeDrag(d.start, p))
        else if (d.startRect)
          setRect(resizeBy(d.startRect, d.handle, p.x - d.start.x, p.y - d.start.y, bounds))
      }}
      onMouseUp={(e) => {
        const d = drag.current
        drag.current = null
        // Work from the drag itself: state may be a render behind a fast drag.
        if (d?.handle !== 'new') return
        const r = normalizeDrag(d.start, point(e))
        setRect(r.width < MIN_SIZE || r.height < MIN_SIZE ? null : r)
      }}
      onDoubleClick={(e) => {
        if (rect && handleAt(rect, point(e), GRAB) === 'move') submit('edit')
      }}
    >
      {!rect && <div className="snap-dim" />}
      {!rect && (
        <div className="hint">
          Drag to select · Enter to edit · Ctrl+C copy · Ctrl+S save · Esc to cancel
        </div>
      )}
      {rect && (
        <div
          className="snap-selection"
          data-testid="snap-selection"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <span className={rect.y < 30 ? 'size inside' : 'size'}>
            {Math.round(rect.width * devicePixelRatio)} ×{' '}
            {Math.round(rect.height * devicePixelRatio)}
          </span>
          {HANDLES.map((h) => (
            <span key={h} className={`handle ${h}`} />
          ))}
          <div
            className={
              rect.y + rect.height + 48 > bounds.height ? 'snap-actions above' : 'snap-actions'
            }
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => submit('edit')} title="Enter">
              Edit
            </button>
            <button onClick={() => submit('copy')} title="Ctrl+C">
              Copy
            </button>
            <button onClick={() => submit('save')} title="Ctrl+S">
              Save
            </button>
            <button onClick={() => submit(null)} title="Esc">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
