import { useRef, useState } from 'react'
import type { BlurOverlay, Overlay } from '../../../shared/edit'
import type { Rect, Size } from '../../../shared/types'
import { isVisibleAt, normalize, overlayBox, type Tool } from './overlayGeometry'

type Drag =
  | { mode: 'create'; from: { x: number; y: number }; rect: Rect }
  | { mode: 'move' | 'resize'; id: string; from: { x: number; y: number }; orig: Rect; rect: Rect }

/** Blur previews. Rendered under the callout canvas, like the export (blur first, then callouts). */
export function BlurLayer({ overlays, srcMs, scale }: { overlays: Overlay[]; srcMs: number; scale: number }): React.JSX.Element {
  return (
    <>
      {overlays
        .filter((o): o is BlurOverlay => o.kind === 'blur' && isVisibleAt(o, srcMs))
        .map((o) => {
          const r = normalize(o.rect)
          return (
            <div
              key={o.id}
              data-testid="preview-blur"
              className="preview-blur"
              style={{
                left: r.x * scale,
                top: r.y * scale,
                width: r.width * scale,
                height: r.height * scale,
                backdropFilter: `blur(${o.strength * scale}px)`
              }}
            />
          )
        })}
    </>
  )
}

type Props = {
  overlays: Overlay[]
  frame: Size
  scale: number
  srcMs: number
  tool: Tool
  selectedId: string | null
  onCreate: (rect: Rect) => void
  onSelect: (id: string | null) => void
  onRect: (id: string, rect: Rect) => void
}

/**
 * Direct manipulation on the preview: draw a new overlay with the active tool, click to select,
 * drag to move, drag the corner to resize. Coordinates are converted to output-frame px.
 */
export default function OverlayLayer(p: Props): React.JSX.Element {
  const layer = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const toFrame = (e: React.PointerEvent): { x: number; y: number } => {
    const r = layer.current!.getBoundingClientRect()
    return {
      x: Math.round(Math.min(p.frame.width, Math.max(0, (e.clientX - r.left) / p.scale))),
      y: Math.round(Math.min(p.frame.height, Math.max(0, (e.clientY - r.top) / p.scale)))
    }
  }

  const onMove = (e: React.PointerEvent): void => {
    if (!drag) return
    const at = toFrame(e)
    const dx = at.x - drag.from.x
    const dy = at.y - drag.from.y
    if (drag.mode === 'create') setDrag({ ...drag, rect: { x: drag.from.x, y: drag.from.y, width: dx, height: dy } })
    else if (drag.mode === 'move') setDrag({ ...drag, rect: { ...drag.orig, x: drag.orig.x + dx, y: drag.orig.y + dy } })
    else setDrag({ ...drag, rect: { ...drag.orig, width: drag.orig.width + dx, height: drag.orig.height + dy } })
  }

  const onUp = (): void => {
    if (!drag) return
    if (drag.mode === 'create') p.onCreate(drag.rect)
    else if (drag.rect !== drag.orig) p.onRect(drag.id, drag.rect)
    setDrag(null)
  }

  const visible = p.overlays.filter((o) => isVisibleAt(o, p.srcMs))
  const s = p.scale

  return (
    <div
      ref={layer}
      className={p.tool ? 'overlay-layer drawing' : 'overlay-layer'}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        if (p.tool) {
          e.currentTarget.setPointerCapture(e.pointerId)
          const at = toFrame(e)
          setDrag({ mode: 'create', from: at, rect: { ...at, width: 0, height: 0 } })
        } else if (e.target === e.currentTarget) p.onSelect(null)
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      {!p.tool &&
        visible.map((o) => {
          const editing = drag && drag.mode !== 'create' && drag.id === o.id
          // Move/resize work on the stored rect; text and lower-thirds only move (their size follows the text).
          const box = editing ? normalize(drag.rect) : overlayBox(o, p.frame)
          const selected = o.id === p.selectedId
          const raw = 'rect' in o ? o.rect : null
          return (
            <div
              key={o.id}
              className={selected ? 'overlay-hit selected' : 'overlay-hit'}
              style={{ left: box.x * s, top: box.y * s, width: Math.max(8, box.width * s), height: Math.max(8, box.height * s) }}
              onPointerDown={(e) => {
                e.stopPropagation()
                p.onSelect(o.id)
                if (!raw) return
                e.currentTarget.parentElement!.setPointerCapture(e.pointerId)
                setDrag({ mode: 'move', id: o.id, from: toFrame(e), orig: raw, rect: raw })
              }}
            >
              {selected && raw && o.kind !== 'text' && (
                <span
                  className="overlay-handle"
                  aria-label="Resize"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    e.currentTarget.parentElement!.parentElement!.setPointerCapture(e.pointerId)
                    setDrag({ mode: 'resize', id: o.id, from: toFrame(e), orig: raw, rect: raw })
                  }}
                />
              )}
            </div>
          )
        })}
      {drag?.mode === 'create' && (
        <div
          className="overlay-draft"
          style={{
            left: normalize(drag.rect).x * s,
            top: normalize(drag.rect).y * s,
            width: normalize(drag.rect).width * s,
            height: normalize(drag.rect).height * s
          }}
        />
      )}
    </div>
  )
}
