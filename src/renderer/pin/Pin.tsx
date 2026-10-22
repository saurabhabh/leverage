import { useEffect, useRef, useState } from 'react'

const id = new URLSearchParams(location.search).get('id') ?? ''

/**
 * A shot pinned above every window (Flameshot's pin): drag to move, wheel to zoom,
 * Ctrl+wheel for opacity, Esc or double-click to close.
 */
export default function Pin(): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const pending = useRef({ dx: 0, dy: 0, frame: 0 })

  useEffect(() => {
    let made = ''
    window.leverage['snap:image'](id, 'rendered').then((png) => {
      made = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
      setUrl(made)
    })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void window.leverage['pin:close']()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      URL.revokeObjectURL(made)
    }
  }, [])

  // One move per frame, however many pointer events arrive.
  const flush = (): void => {
    const p = pending.current
    p.frame = 0
    if (p.dx || p.dy) void window.leverage['pin:move'](p.dx, p.dy)
    p.dx = 0
    p.dy = 0
  }

  return (
    <div
      className="pin"
      data-testid="pin"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        last.current = { x: e.screenX, y: e.screenY }
      }}
      onPointerMove={(e) => {
        if (!last.current) return
        pending.current.dx += e.screenX - last.current.x
        pending.current.dy += e.screenY - last.current.y
        last.current = { x: e.screenX, y: e.screenY }
        pending.current.frame ||= requestAnimationFrame(flush)
      }}
      onPointerUp={() => (last.current = null)}
      onDoubleClick={() => void window.leverage['pin:close']()}
      onWheel={(e) => {
        const up = e.deltaY < 0
        if (e.ctrlKey) void window.leverage['pin:opacity'](up ? 0.1 : -0.1)
        else void window.leverage['pin:zoom'](up ? 1.1 : 1 / 1.1)
      }}
    >
      {url && <img src={url} alt="Pinned screenshot" draggable={false} />}
    </div>
  )
}
