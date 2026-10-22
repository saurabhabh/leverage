import { useLayoutEffect, useRef, useState } from 'react'
import { outputDurationMs, type EditDoc } from '../../../shared/edit'
import { clock } from './time'

export type Selection = { kind: 'clip' | 'overlay'; id: string } | null
export type Mark = { inMs?: number; outMs?: number }

/** Zoom range in ms per pixel; each step halves or doubles. */
export const ZOOM_MIN = 1
export const ZOOM_MAX = 6000

type Props = {
  edit: EditDoc
  timeMs: number
  selection: Selection
  mark: Mark
  /** null = fit the whole edit to the visible width. */
  zoomMsPerPx: number | null
  onSeek: (outMs: number) => void
  onSelect: (sel: Selection) => void
  onMoveClip: (clipId: string, toIndex: number) => void
  onZoom: (msPerPx: number | null) => void
  onFitChange?: (fitMsPerPx: number) => void
  /** Extra lanes (overlays, audio) drawn at the same scale. */
  lanes?: (msPerPx: number) => React.ReactNode
}

function tickStep(msPerPx: number): number {
  const minPx = 80
  for (const step of [100, 200, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000]) {
    if (step / msPerPx >= minPx) return step
  }
  return 1_800_000
}

export default function Timeline(props: Props): React.JSX.Element {
  const { edit, timeMs, selection, mark, zoomMsPerPx, onSeek, onSelect, onMoveClip, onZoom, lanes } = props
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const total = outputDurationMs(edit)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = (): void => setWidth(Math.max(200, el.clientWidth - 24))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = Math.max(1, total / width)
  const msPerPx = zoomMsPerPx ?? fit
  const px = (ms: number): number => ms / msPerPx
  const contentWidth = Math.max(width, px(total))

  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    onSeek(Math.min(total, Math.max(0, (e.clientX - rect.left) * msPerPx)))
  }

  const zoomBy = (dir: 1 | -1): void => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, dir > 0 ? msPerPx / 2 : msPerPx * 2))
    // Zooming out past the whole edit snaps back to fit.
    onZoom(next >= fit ? null : next)
  }

  const step = tickStep(msPerPx)
  const ticks: number[] = []
  for (let t = 0; t <= total; t += step) ticks.push(t)

  let start = 0
  const starts = edit.clips.map((c) => {
    const s = start
    start += c.srcEndMs - c.srcStartMs
    return s
  })

  return (
    <div className="timeline">
      <div className="timeline-tools">
        <button className="btn" aria-label="Zoom out" onClick={() => zoomBy(-1)}>
          −
        </button>
        <button className="btn" aria-label="Fit" onClick={() => onZoom(null)}>
          Fit
        </button>
        <button className="btn" aria-label="Zoom in" onClick={() => zoomBy(1)}>
          +
        </button>
        <span className="muted timeline-hint">S split · I/O mark · X cut · Del delete · drag to reorder</span>
      </div>
      <div
        className="timeline-scroll"
        ref={scroller}
        onWheel={(e) => {
          if (!e.ctrlKey) return
          e.preventDefault()
          zoomBy(e.deltaY < 0 ? 1 : -1)
        }}
      >
        <div className="timeline-content" style={{ width: contentWidth }}>
          <div className="ruler" onMouseDown={seekFromEvent} data-testid="ruler">
            {ticks.map((t) => (
              <span key={t} className="tick" style={{ left: px(t) }}>
                {clock(t)}
              </span>
            ))}
          </div>

          <div className="clip-lane">
            {edit.clips.map((c, i) => {
              const selected = selection?.kind === 'clip' && selection.id === c.id
              return (
                <div
                  key={c.id}
                  data-testid="clip"
                  className={selected ? 'clip selected' : 'clip'}
                  style={{ left: px(starts[i]), width: Math.max(2, px(c.srcEndMs - c.srcStartMs)) }}
                  draggable
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect({ kind: 'clip', id: c.id })
                  }}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/x-leverage-clip', c.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    const r = e.currentTarget.getBoundingClientRect()
                    setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1)
                  }}
                  onDragLeave={() => setDropAt(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    const id = e.dataTransfer.getData('text/x-leverage-clip')
                    const r = e.currentTarget.getBoundingClientRect()
                    const target = e.clientX < r.left + r.width / 2 ? i : i + 1
                    const from = edit.clips.findIndex((x) => x.id === id)
                    setDropAt(null)
                    if (id && from >= 0) onMoveClip(id, target > from ? target - 1 : target)
                  }}
                  title={`Source ${clock(c.srcStartMs)}–${clock(c.srcEndMs)}`}
                >
                  <span>
                    {clock(c.srcStartMs)}–{clock(c.srcEndMs)}
                  </span>
                </div>
              )
            })}
            {dropAt !== null && (
              <div
                className="drop-indicator"
                style={{ left: px(dropAt < starts.length ? starts[dropAt] : total) }}
              />
            )}
          </div>

          {lanes?.(msPerPx)}

          {mark.inMs !== undefined && mark.outMs !== undefined && mark.outMs > mark.inMs && (
            <div
              className="mark"
              data-testid="mark"
              style={{ left: px(mark.inMs), width: px(mark.outMs - mark.inMs) }}
            />
          )}
          {mark.inMs !== undefined && <div className="mark-edge" style={{ left: px(mark.inMs) }} />}
          {mark.outMs !== undefined && <div className="mark-edge" style={{ left: px(mark.outMs) }} />}
          <div className="playhead" style={{ left: px(timeMs) }} />
        </div>
      </div>
    </div>
  )
}
