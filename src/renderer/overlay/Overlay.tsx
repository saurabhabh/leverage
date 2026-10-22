import { useEffect, useState } from 'react'
import { normalizeDrag } from '../../shared/region'
import type { Rect } from '../../shared/types'

const MIN_SIZE = 5
const params = new URLSearchParams(location.search)
const displayId = params.get('displayId') ?? ''
const origin = { x: Number(params.get('x') ?? 0), y: Number(params.get('y') ?? 0) }

type Point = { x: number; y: number }

/** Full-display, dimmed layer: drag a rectangle; Esc or right-click cancels. Coordinates are DIP. */
export default function Overlay(): React.JSX.Element {
  const [start, setStart] = useState<Point | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void window.leverage['region:submit'](null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const point = (e: React.MouseEvent): Point => ({ x: e.clientX, y: e.clientY })

  return (
    <div
      className="overlay"
      onContextMenu={(e) => {
        e.preventDefault()
        void window.leverage['region:submit'](null)
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        setStart(point(e))
        setRect(null)
      }}
      onMouseMove={(e) => {
        if (start) setRect(normalizeDrag(start, point(e)))
      }}
      onMouseUp={(e) => {
        if (!start || e.button !== 0) return
        const r = normalizeDrag(start, point(e))
        setStart(null)
        if (r.width < MIN_SIZE || r.height < MIN_SIZE) {
          setRect(null)
          return
        }
        void window.leverage['region:submit']({
          displayId,
          rectDip: { x: r.x + origin.x, y: r.y + origin.y, width: r.width, height: r.height }
        })
      }}
    >
      {!rect && <div className="hint">Drag to select the area to record · Esc to cancel</div>}
      {rect && (
        <div
          className="selection"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <span className="size">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </span>
        </div>
      )}
    </div>
  )
}
