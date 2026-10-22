import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeDrag } from '../../../shared/region'
import type { Point, Shape, SnapDoc } from '../../../shared/snap'
import { LINE_HEIGHT, renderDoc, textFont } from './draw'
import { exportPng } from './exportPng'
import { hitTest, moveShape, normalizeRect, shapeBounds, snapAngle, type Measure } from './geometry'
import { UndoStack } from './undo'

type Tool =
  | 'select'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'marker'
  | 'text'
  | 'counter'
  | 'pixelate'
  | 'redact'
  | 'crop'

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: 'v' },
  { id: 'pen', label: 'Pen', key: 'p' },
  { id: 'line', label: 'Line', key: 'l' },
  { id: 'arrow', label: 'Arrow', key: 'a' },
  { id: 'rect', label: 'Rectangle', key: 'r' },
  { id: 'ellipse', label: 'Ellipse', key: 'e' },
  { id: 'marker', label: 'Highlighter', key: 'm' },
  { id: 'text', label: 'Text', key: 't' },
  { id: 'counter', label: 'Step', key: 'n' },
  { id: 'pixelate', label: 'Pixelate', key: 'b' },
  { id: 'redact', label: 'Redact', key: 'x' },
  { id: 'crop', label: 'Crop', key: 'c' }
]

/** Each tool keeps its own size, as in Flameshot (font size and pixel block size differ from stroke width). */
const DEFAULT_SIZES: Record<Tool, number> = {
  select: 3,
  pen: 3,
  line: 3,
  arrow: 3,
  rect: 3,
  ellipse: 3,
  marker: 5,
  text: 24,
  counter: 3,
  pixelate: 10,
  redact: 1,
  crop: 1
}
const sizeRange = (t: Tool): [number, number] =>
  t === 'text' ? [8, 120] : t === 'pixelate' ? [4, 48] : [1, 20]
const SIZED: Tool[] = [
  'pen',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'marker',
  'text',
  'counter',
  'pixelate'
]
const PALETTE = [
  '#ff0000',
  '#ff9500',
  '#ffd60a',
  '#34c759',
  '#0a84ff',
  '#bf5af2',
  '#000000',
  '#ffffff'
]
const REDACT_COLOR = '#000000'

let counter = 0
const newId = (): string => `${Date.now().toString(36)}${(counter++).toString(36)}`
const message = (err: unknown): string =>
  err instanceof Error ? err.message.split('\n')[0] : String(err)

const measureCtx = document.createElement('canvas').getContext('2d')!
const measure: Measure = (text, px) => {
  measureCtx.font = textFont(px, false)
  const lines = text.split('\n')
  return {
    width: Math.max(...lines.map((l) => measureCtx.measureText(l).width)),
    height: lines.length * px * LINE_HEIGHT
  }
}

/** `preview` mirrors the preview state, so pointer-up never sees a render behind. */
type Drag = {
  kind: 'draw' | 'move'
  start: Point
  base: SnapDoc
  points: Point[]
  preview: SnapDoc | null
}
type TextEdit = { id: string | null; at: Point; value: string }

/** Snagit-style editor for one shot. Every change is autosaved (shape list + rendered PNG). */
export default function SnapEditor({
  id,
  onBack
}: {
  id: string
  onBack: () => void
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stack = useRef<UndoStack<SnapDoc> | null>(null)
  const drag = useRef<Drag | null>(null)
  const dirty = useRef<SnapDoc | null>(null)
  const saveTimer = useRef(0)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const flushRef = useRef<() => Promise<void>>(async () => {})

  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [doc, setDoc] = useState<SnapDoc | null>(null)
  const [preview, setPreview] = useState<SnapDoc | null>(null)
  const [hist, setHist] = useState({ undo: false, redo: false })
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState(PALETTE[0])
  const [sizes, setSizes] = useState(DEFAULT_SIZES)
  const [filled, setFilled] = useState(false)
  const [bold, setBold] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null)
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const [status, setStatus] = useState<string>('Saved')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let url = ''
    Promise.all([window.leverage['snap:get'](id), window.leverage['snap:image'](id, 'original')])
      .then(async ([d, png]) => {
        url = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
        const img = new Image()
        img.src = url
        await img.decode()
        if (!alive) return
        stack.current = new UndoStack(d)
        setImage(img)
        setDoc(d)
      })
      .catch((err) => alive && setError(message(err)))
    return () => {
      alive = false
      URL.revokeObjectURL(url)
    }
  }, [id])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) =>
      setStage({ width: entry.contentRect.width, height: entry.contentRect.height })
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(saveTimer.current)
    const d = dirty.current
    if (!d || !image) return saving.current
    dirty.current = null
    setStatus('Saving…')
    saving.current = saving.current
      .then(async () => {
        await window.leverage['snap:save'](id, d, await exportPng(d, image))
        if (!dirty.current) setStatus('Saved')
      })
      .catch((err) => {
        setStatus('Not saved')
        setError(`Could not save: ${message(err)}`)
      })
    return saving.current
  }, [id, image])

  // Save whatever is pending when the editor closes.
  useEffect(() => {
    flushRef.current = flush
  }, [flush])
  useEffect(() => () => void flushRef.current(), [])

  const changed = (next: SnapDoc): void => {
    setDoc(next)
    setPreview(null)
    setHist({ undo: stack.current!.canUndo, redo: stack.current!.canRedo })
    dirty.current = next
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void flush(), 400)
  }
  const commit = (next: SnapDoc): void => {
    stack.current!.push(next)
    changed(next)
  }
  const undo = (): void => {
    if (stack.current?.canUndo) changed(stack.current.undo())
  }
  const redo = (): void => {
    if (stack.current?.canRedo) changed(stack.current.redo())
  }

  const removeSelected = (): void => {
    if (!doc || !selected) return
    commit({ ...doc, shapes: doc.shapes.filter((s) => s.id !== selected) })
    setSelected(null)
  }

  /** Colour and size changes also restyle the selected shape (Flameshot does the same). */
  const restyleSelected = (patch: Partial<Pick<Shape, 'color' | 'size'>>): void => {
    if (!doc || !selected || tool !== 'select') return
    commit({
      ...doc,
      shapes: doc.shapes.map((s) => (s.id === selected ? ({ ...s, ...patch } as Shape) : s))
    })
  }
  const pickColor = (c: string): void => {
    setColor(c)
    restyleSelected({ color: c })
  }
  const sizeTool: Tool =
    tool === 'select' ? (doc?.shapes.find((s) => s.id === selected)?.kind ?? 'select') : tool
  const setSize = (n: number): void => {
    const [lo, hi] = sizeRange(sizeTool)
    const size = Math.max(lo, Math.min(hi, Math.round(n)))
    setSizes((s) => ({ ...s, [sizeTool]: size }))
    restyleSelected({ size })
  }

  const commitText = (): void => {
    const t = textEdit
    setTextEdit(null)
    if (!t || !doc) return
    const value = t.value.replace(/\s+$/, '')
    if (t.id) {
      const shapes = value
        ? doc.shapes.map((s) => (s.id === t.id && s.kind === 'text' ? { ...s, text: value } : s))
        : doc.shapes.filter((s) => s.id !== t.id)
      commit({ ...doc, shapes })
    } else if (value) {
      commit({
        ...doc,
        shapes: [
          ...doc.shapes,
          { id: newId(), kind: 'text', color, size: sizes.text, at: t.at, text: value, bold }
        ]
      })
    }
  }

  const copy = async (): Promise<void> => {
    await flush()
    await window.leverage['snap:copy'](id)
    setStatus('Copied to clipboard')
  }
  const saveAs = async (): Promise<void> => {
    await flush()
    const out = await window.leverage['snap:saveAs'](id)
    if (out) setStatus(`Saved to ${out}`)
  }
  const pin = async (): Promise<void> => {
    await flush()
    await window.leverage['snap:pin'](id)
  }
  const remove = async (): Promise<void> => {
    if (!window.confirm('Move this screenshot to the Recycle Bin?')) return
    window.clearTimeout(saveTimer.current)
    dirty.current = null
    await saving.current
    await window.leverage['snap:delete'](id)
    onBack()
  }
  const back = async (): Promise<void> => {
    await flush()
    onBack()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (textEdit || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const ctrl = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (ctrl && key === 'z' && !e.shiftKey) undo()
      else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) redo()
      else if (ctrl && key === 'c') void copy()
      else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected()
      else if (e.key === 'Escape') setSelected(null)
      else if (e.key === '[') setSize(sizes[sizeTool] - 1)
      else if (e.key === ']') setSize(sizes[sizeTool] + 1)
      else if (!ctrl && !e.altKey && TOOLS.some((t) => t.key === key))
        setTool(TOOLS.find((t) => t.key === key)!.id)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const shown = preview ?? doc
  const scale = doc
    ? Math.min(
        1 / devicePixelRatio,
        (stage.width || doc.width) / doc.width,
        (stage.height || doc.height) / doc.height
      )
    : 1

  // Paint the shot, plus editor-only guides (crop shade, selection outline).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image || !shown) return
    const visible = textEdit?.id
      ? { ...shown, shapes: shown.shapes.filter((s) => s.id !== textEdit.id) }
      : shown
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    renderDoc(ctx, visible, image)
    const px = 1 / scale
    if (visible.crop) {
      const c = normalizeRect(visible.crop)
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.beginPath()
      ctx.rect(0, 0, visible.width, visible.height)
      ctx.rect(c.x, c.y, c.width, c.height)
      ctx.fill('evenodd')
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = px
      ctx.setLineDash([6 * px, 4 * px])
      ctx.strokeRect(c.x, c.y, c.width, c.height)
      ctx.restore()
    }
    const sel = selected && visible.shapes.find((s) => s.id === selected)
    if (sel) {
      const b = shapeBounds(sel, measure)
      ctx.save()
      ctx.strokeStyle = '#0a84ff'
      ctx.lineWidth = 1.5 * px
      ctx.setLineDash([5 * px, 4 * px])
      ctx.strokeRect(b.x - 4 * px, b.y - 4 * px, b.width + 8 * px, b.height + 8 * px)
      ctx.restore()
    }
  }, [image, shown, selected, textEdit, scale])

  const toImage = (e: React.PointerEvent | React.MouseEvent): Point => {
    const r = canvasRef.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) * doc!.width) / r.width,
      y: ((e.clientY - r.top) * doc!.height) / r.height
    }
  }

  const draft = (d: Drag, p: Point, shift: boolean): SnapDoc => {
    const size = sizes[tool]
    const end = shift ? snapAngle(d.start, p) : p
    const box = normalizeDrag(d.start, p)
    let shape: Shape
    switch (tool) {
      case 'crop':
        return { ...d.base, crop: box }
      case 'pen':
      case 'marker':
        shape = { id: 'draft', kind: tool, color, size, points: d.points }
        break
      case 'line':
      case 'arrow':
        shape = { id: 'draft', kind: tool, color, size, a: d.start, b: end }
        break
      case 'rect':
      case 'ellipse':
        shape = { id: 'draft', kind: tool, color, size, rect: box, filled }
        break
      case 'pixelate':
        shape = { id: 'draft', kind: 'pixelate', color, size, rect: box }
        break
      default:
        shape = { id: 'draft', kind: 'redact', color: REDACT_COLOR, size: 1, rect: box }
    }
    return { ...d.base, shapes: [...d.base.shapes, shape] }
  }

  const show = (d: Drag, next: SnapDoc): void => {
    d.preview = next
    setPreview(next)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0 || !doc) return
    if (textEdit) return commitText()
    const p = toImage(e)
    if (tool === 'select') {
      const hit = hitTest(doc.shapes, p, 4 / scale, measure)
      setSelected(hit)
      if (hit) {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { kind: 'move', start: p, base: doc, points: [], preview: null }
      }
      return
    }
    setSelected(null)
    if (tool === 'text') return setTextEdit({ id: null, at: p, value: '' })
    if (tool === 'counter') {
      return commit({
        ...doc,
        shapes: [...doc.shapes, { id: newId(), kind: 'counter', color, size: sizes.counter, at: p }]
      })
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const d: Drag = { kind: 'draw', start: p, base: doc, points: [p], preview: null }
    drag.current = d
    show(d, draft(d, p, e.shiftKey))
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const p = toImage(e)
    if (d.kind === 'move') {
      const dx = p.x - d.start.x
      const dy = p.y - d.start.y
      show(d, {
        ...d.base,
        shapes: d.base.shapes.map((s) => (s.id === selected ? moveShape(s, dx, dy) : s))
      })
      return
    }
    d.points.push(p)
    show(d, draft(d, p, e.shiftKey))
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const d = drag.current
    drag.current = null
    const preview = d?.preview
    if (!d || !preview) return setPreview(null)
    const p = toImage(e)
    const tiny = Math.hypot(p.x - d.start.x, p.y - d.start.y) < 3
    if (d.kind === 'move') return tiny ? setPreview(null) : commit(preview)
    const isBox = tool !== 'pen' && tool !== 'marker'
    if (tiny && isBox) return setPreview(null)
    if (tool === 'crop') {
      const c = normalizeRect(preview.crop!)
      const x = Math.max(0, c.x)
      const y = Math.max(0, c.y)
      const crop = {
        x,
        y,
        width: Math.min(doc!.width, c.x + c.width) - x,
        height: Math.min(doc!.height, c.y + c.height) - y
      }
      return commit({ ...preview, crop })
    }
    const last = preview.shapes[preview.shapes.length - 1]
    commit({ ...preview, shapes: [...preview.shapes.slice(0, -1), { ...last, id: newId() }] })
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    if (!doc) return
    const hit = hitTest(doc.shapes, toImage(e), 4 / scale, measure)
    const shape = doc.shapes.find((s) => s.id === hit)
    if (shape?.kind === 'text') setTextEdit({ id: shape.id, at: shape.at, value: shape.text })
  }

  if (error && !doc) {
    return (
      <div className="page">
        <button className="btn" onClick={onBack}>
          ← Snap
        </button>
        <div className="banner error">{error}</div>
      </div>
    )
  }

  const editing =
    textEdit && doc ? (textEdit.id ? doc.shapes.find((s) => s.id === textEdit.id) : null) : null
  const textSize = editing?.size ?? sizes.text
  const textBold = editing?.kind === 'text' ? editing.bold : bold

  return (
    <div className="snap-editor" data-testid="snap-editor">
      <div className="snap-top">
        <button className="btn" onClick={back}>
          ← Snap
        </button>
        <div className="snap-title">{id}</div>
        <span className="muted" role="status">
          {status}
        </span>
        <div className="spacer" />
        <button className="btn primary" onClick={copy}>
          Copy
        </button>
        <button className="btn" onClick={saveAs}>
          Save as…
        </button>
        <button className="btn" onClick={pin}>
          Pin
        </button>
        <button className="btn" onClick={() => window.leverage['snap:show'](id)}>
          Show in folder
        </button>
        <button className="btn" onClick={remove}>
          Delete
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}

      <div className="snap-tools" role="toolbar" aria-label="Annotation tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? 'tool active' : 'tool'}
            aria-pressed={tool === t.id}
            title={`${t.label} (${t.key.toUpperCase()})`}
            onClick={() => setTool(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className="tool-sep" />
        {PALETTE.map((c) => (
          <button
            key={c}
            className={color === c ? 'swatch active' : 'swatch'}
            style={{ background: c }}
            aria-label={`Colour ${c}`}
            onClick={() => pickColor(c)}
          />
        ))}
        <input
          type="color"
          aria-label="Custom colour"
          value={color}
          onChange={(e) => pickColor(e.target.value)}
        />
        {SIZED.includes(sizeTool) && (
          <label className="tool-size">
            Size
            <input
              type="range"
              aria-label="Size"
              min={sizeRange(sizeTool)[0]}
              max={sizeRange(sizeTool)[1]}
              value={sizes[sizeTool]}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </label>
        )}
        {(tool === 'rect' || tool === 'ellipse') && (
          <label className="tool-check">
            <input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} />{' '}
            Filled
          </label>
        )}
        {tool === 'text' && (
          <label className="tool-check">
            <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} />{' '}
            Bold
          </label>
        )}
        {tool === 'crop' && doc?.crop && (
          <button className="btn" onClick={() => commit({ ...doc, crop: undefined })}>
            Reset crop
          </button>
        )}
        <span className="spacer" />
        <button className="btn" disabled={!hist.undo} onClick={undo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button className="btn" disabled={!hist.redo} onClick={redo} title="Redo (Ctrl+Y)">
          Redo
        </button>
      </div>

      <div className="snap-stage" ref={stageRef}>
        {doc && (
          <div
            className="snap-canvas"
            style={{ width: doc.width * scale, height: doc.height * scale }}
          >
            <canvas
              ref={canvasRef}
              width={doc.width}
              height={doc.height}
              data-tool={tool}
              data-testid="snap-canvas"
              style={{ width: doc.width * scale, height: doc.height * scale }}
              onPointerDown={onPointerDown}
              // Keep focus where it is: a click must not blur the text box it just opened.
              onMouseDown={(e) => e.preventDefault()}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onDoubleClick={onDoubleClick}
              onWheel={(e) => setSize(sizes[sizeTool] + (e.deltaY < 0 ? 1 : -1))}
            />
            {textEdit && (
              <textarea
                className="snap-text"
                aria-label="Text"
                autoFocus
                value={textEdit.value}
                rows={Math.max(1, textEdit.value.split('\n').length)}
                style={{
                  left: textEdit.at.x * scale,
                  top: textEdit.at.y * scale,
                  color: editing?.color ?? color,
                  font: textFont(textSize * scale, textBold),
                  lineHeight: LINE_HEIGHT
                }}
                onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
                onBlur={commitText}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Escape') setTextEdit(null)
                  else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    commitText()
                  }
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
