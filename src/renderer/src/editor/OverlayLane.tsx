import { useState } from 'react'
import { sourceToOutput, type EditDoc, type Overlay } from '../../../shared/edit'

const LABEL: Record<Overlay['kind'], string> = {
  blur: 'Blur',
  arrow: 'Arrow',
  box: 'Box',
  text: 'Text',
  lowerThird: 'Lower third'
}

type Props = {
  edit: EditDoc
  msPerPx: number
  selectedId: string | null
  onSelect: (id: string) => void
  /** New source span after dragging a bar (move) or its right edge (resize). */
  onSpan: (id: string, srcStartMs: number, srcEndMs: number) => void
}

type Drag = { id: string; mode: 'move' | 'end'; x0: number; dx: number }

const ROW_PX = 24

/** Greedy packing: each overlay goes in the first row where it doesn't overlap (by output time). */
export function packRows(edit: EditDoc): Map<string, number> {
  const spans = edit.overlays
    .map((o) => ({ id: o.id, ivs: sourceToOutput(edit, o.srcStartMs, o.srcEndMs) }))
    .filter((s) => s.ivs.length > 0)
    .sort((a, b) => a.ivs[0].outStartMs - b.ivs[0].outStartMs)
  const rows: { outStartMs: number; outEndMs: number }[][] = []
  const out = new Map<string, number>()
  for (const s of spans) {
    const overlaps = (row: { outStartMs: number; outEndMs: number }[]): boolean =>
      row.some((r) => s.ivs.some((iv) => iv.outStartMs < r.outEndMs && r.outStartMs < iv.outEndMs))
    let i = rows.findIndex((row) => !overlaps(row))
    if (i < 0) i = rows.push([]) - 1
    rows[i].push(...s.ivs)
    out.set(s.id, i)
  }
  return out
}

/** One bar per place an overlay plays in the output; overlays fully cut out show nothing. */
export default function OverlayLane({ edit, msPerPx, selectedId, onSelect, onSpan }: Props): React.JSX.Element | null {
  const [drag, setDrag] = useState<Drag | null>(null)
  if (edit.overlays.length === 0) return null
  const rows = packRows(edit)
  const rowCount = Math.max(1, ...[...rows.values()].map((r) => r + 1))

  const finish = (): void => {
    if (!drag) return
    const o = edit.overlays.find((x) => x.id === drag.id)
    const delta = Math.round(drag.dx * msPerPx)
    setDrag(null)
    if (!o || delta === 0) return
    if (drag.mode === 'move') {
      const start = Math.max(0, o.srcStartMs + delta)
      onSpan(o.id, start, start + (o.srcEndMs - o.srcStartMs))
    } else onSpan(o.id, o.srcStartMs, Math.max(o.srcStartMs + 100, o.srcEndMs + delta))
  }

  return (
    <div
      className="lane overlay-lane"
      style={{ height: rowCount * ROW_PX }}
      onPointerMove={(e) => drag && setDrag({ ...drag, dx: e.clientX - drag.x0 })}
      onPointerUp={finish}
    >
      <span className="lane-label">Overlays</span>
      {edit.overlays.flatMap((o) =>
        sourceToOutput(edit, o.srcStartMs, o.srcEndMs).map((iv, i) => {
          const active = drag?.id === o.id
          const shift = active && drag.mode === 'move' ? drag.dx : 0
          const grow = active && drag.mode === 'end' ? drag.dx : 0
          return (
            <div
              key={`${o.id}-${i}`}
              data-testid="overlay-bar"
              className={o.id === selectedId ? `overlay-bar ${o.kind} selected` : `overlay-bar ${o.kind}`}
              style={{
                top: 2 + (rows.get(o.id) ?? 0) * ROW_PX,
                left: iv.outStartMs / msPerPx + shift,
                width: Math.max(6, (iv.outEndMs - iv.outStartMs) / msPerPx + grow)
              }}
              onPointerDown={(e) => {
                e.stopPropagation()
                onSelect(o.id)
                e.currentTarget.parentElement!.setPointerCapture(e.pointerId)
                setDrag({ id: o.id, mode: 'move', x0: e.clientX, dx: 0 })
              }}
            >
              {LABEL[o.kind]}
              <span
                className="bar-end"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onSelect(o.id)
                  e.currentTarget.parentElement!.parentElement!.setPointerCapture(e.pointerId)
                  setDrag({ id: o.id, mode: 'end', x0: e.clientX, dx: 0 })
                }}
              />
            </div>
          )
        })
      )}
    </div>
  )
}
