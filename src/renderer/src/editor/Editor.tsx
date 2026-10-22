import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addOverlay,
  cutRange,
  deleteClip,
  moveClip,
  newId,
  outputDurationMs,
  outputToSource,
  relativeOffsets,
  removeOverlay,
  setCamera,
  setGain,
  setMuted,
  splitAt,
  updateOverlay,
  type EditDoc,
  type Overlay
} from '../../../shared/edit'
import type { Rect } from '../../../shared/types'
import { drawOverlay } from './drawOverlay'
import Inspector from './Inspector'
import CameraPanel from './CameraPanel'
import AudioLanes from './AudioLanes'
import OverlayLane from './OverlayLane'
import OverlayLayer, { BlurLayer } from './OverlayLayer'
import { isVisibleAt, newSpan, normalize, SWATCHES, type Tool } from './overlayGeometry'
import { History } from '../../../shared/history'
import type { OpenedEdit } from '../../../shared/ipc'
import type { Size, TrackKind } from '../../../shared/types'
import Preview, { type PreviewHandle } from './Preview'
import { PlaybackController } from './player'
import Timeline, { type Mark, type Selection } from './Timeline'
import { clock } from './time'
import { exportRecording } from './exportPrep'
import './editor.css'

type Props = { recordingId: string; onBack: () => void }

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)
const AUTOSAVE_MS = 500

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ['TEXTAREA', 'SELECT'].includes(t.tagName) ||
    (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range'))

export default function Editor({ recordingId, onBack }: Props): React.JSX.Element {
  const [opened, setOpened] = useState<OpenedEdit | null>(null)
  const [edit, setEdit] = useState<EditDoc | null>(null)
  const [urls, setUrls] = useState<Partial<Record<TrackKind, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [timeMs, setTimeMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selection, setSelection] = useState<Selection>(null)
  const [mark, setMark] = useState<Mark>({})
  const [zoom, setZoom] = useState<number | null>(null)
  const [tool, setTool] = useState<Tool>(null)
  const [exporting, setExporting] = useState<{ pct: number } | { done: string } | { error: string } | null>(null)
  const preview = useRef<PreviewHandle>(null)
  const player = useRef<PlaybackController | null>(null)
  const history = useRef<History<EditDoc> | null>(null)
  const saved = useRef<EditDoc | null>(null)

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
        history.current = new History(o.edit)
        saved.current = o.edit
        setUrls(Object.fromEntries(entries))
        setOpened(o)
        setEdit(o.edit)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [recordingId])

  // Autosave: debounced while editing, and flushed at once when leaving or exporting.
  const latest = useRef<EditDoc | null>(null)
  const flush = useCallback((): Promise<void> => {
    const e = latest.current
    if (!e || e === saved.current) return Promise.resolve()
    saved.current = e
    return window.leverage['edit:save'](recordingId, e).then(
      () => setSaveError(null),
      (err) => setSaveError(err instanceof Error ? err.message : String(err))
    )
  }, [recordingId])

  useEffect(() => {
    latest.current = edit
    if (!edit || edit === saved.current) return
    const t = window.setTimeout(() => void flush(), AUTOSAVE_MS)
    return () => window.clearTimeout(t)
  }, [edit, flush])

  useEffect(() => {
    const onClose = (): void => void flush()
    window.addEventListener('beforeunload', onClose)
    return () => {
      window.removeEventListener('beforeunload', onClose)
      void flush()
    }
  }, [flush])

  const frame: Size | null = useMemo(() => {
    if (!opened) return null
    const s = opened.manifest.crop ?? opened.manifest.videoSize
    return { width: even(s.width), height: even(s.height) }
  }, [opened])

  useEffect(() => {
    if (!opened || !preview.current) return
    const p = new PlaybackController({
      media: preview.current.media(),
      offsetsMs: relativeOffsets(opened.manifest),
      now: () => performance.now(),
      raf: (cb) => requestAnimationFrame(cb),
      cancelRaf: (h) => cancelAnimationFrame(h as number)
    })
    p.onTime = setTimeMs
    p.onEnded = () => setPlaying(false)
    player.current = p
    return () => {
      p.pause()
      player.current = null
    }
  }, [opened])

  useEffect(() => {
    if (!edit) return
    player.current?.setEdit(edit)
    setTimeMs(player.current?.timeMs ?? 0)
  }, [edit, opened])

  /** Every edit goes through history so it can be undone. */
  const commit = useCallback((next: EditDoc) => {
    const h = history.current
    if (!h || next === h.present) return
    h.push(next)
    setEdit(h.present)
  }, [])

  const undo = useCallback(() => history.current && setEdit(history.current.undo()), [])
  const redo = useCallback(() => history.current && setEdit(history.current.redo()), [])

  const togglePlay = useCallback(() => {
    const p = player.current
    if (!p) return
    if (p.playing) p.pause()
    else p.play()
    setPlaying(p.playing)
  }, [])

  const seek = useCallback((ms: number) => {
    player.current?.seek(ms)
    setTimeMs(player.current?.timeMs ?? ms)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target) || !history.current) return
      const present = history.current.present
      const now = player.current?.timeMs ?? 0
      const key = e.key.toLowerCase()
      if (e.ctrlKey && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (e.ctrlKey && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      } else if (e.ctrlKey || e.altKey || e.metaKey) {
        return
      } else if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') seek(now - 1000)
      else if (e.key === 'ArrowRight') seek(now + 1000)
      else if (key === 's') commit(splitAt(present, now))
      else if (key === 'i') setMark((m) => ({ ...m, inMs: now }))
      else if (key === 'o') setMark((m) => ({ ...m, outMs: now }))
      else if (key === 'x') {
        setMark((m) => {
          if (m.inMs !== undefined && m.outMs !== undefined) commit(cutRange(present, m.inMs, m.outMs))
          return {}
        })
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection?.kind === 'clip') commit(deleteClip(present, selection.id))
        else if (selection?.kind === 'overlay') commit(removeOverlay(present, selection.id))
        setSelection(null)
      } else if (e.key === 'Escape') {
        setTool(null)
        setSelection(null)
        setMark({})
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seek, commit, undo, redo, selection])

  const total = edit ? outputDurationMs(edit) : 0

  useEffect(
    () =>
      window.leverage.on('export:progress', ({ id, pct }) => {
        if (id === recordingId) setExporting((x) => (x && 'pct' in x ? { pct } : x))
      }),
    [recordingId]
  )

  const runExport = async (kind: 'mp4' | 'gif'): Promise<void> => {
    if (!edit) return
    player.current?.pause()
    setPlaying(false)
    setExporting({ pct: 0 })
    try {
      // Save now rather than waiting for the autosave, so the export has the latest edit.
      await flush()
      const out = await exportRecording(recordingId, kind)
      setExporting(out ? { done: out } : null)
    } catch (err) {
      setExporting({ error: err instanceof Error ? err.message.split('\n')[0] : String(err) })
    }
  }
  const srcMs = edit ? outputToSource(edit, timeMs).srcMs : 0
  const selectedOverlay =
    selection?.kind === 'overlay' ? edit?.overlays.find((o) => o.id === selection.id) : undefined

  // Callouts and lower-thirds are drawn with the same code the export rasterizes.
  useEffect(() => {
    const canvas = preview.current?.overlayCanvas()
    if (!canvas || !edit || !frame) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const s = canvas.width / frame.width
    ctx.setTransform(s, 0, 0, s, 0, 0)
    for (const o of edit.overlays) {
      if (o.kind !== 'blur' && isVisibleAt(o, srcMs)) drawOverlay(ctx, o, frame)
    }
  })

  const createOverlay = (rect: Rect): void => {
    if (!edit || !tool) return
    const span = newSpan(edit, timeMs)
    const id = newId()
    let o: Overlay
    if (tool === 'text') o = { id, kind: 'text', ...span, rect: { x: rect.x, y: rect.y, width: 0, height: 0 }, text: 'Text', color: SWATCHES[0] }
    else {
      const r = tool === 'arrow' ? rect : normalize(rect)
      // Blur and box need some area; an arrow just needs some length.
      if (tool === 'arrow' ? Math.hypot(r.width, r.height) < 8 : Math.abs(r.width) < 8 || Math.abs(r.height) < 8) return
      o =
        tool === 'blur'
          ? { id, kind: 'blur', ...span, rect: r, strength: 10 }
          : { id, kind: tool, ...span, rect: r, text: '', color: SWATCHES[0] }
    }
    commit(addOverlay(edit, o))
    setSelection({ kind: 'overlay', id })
    setTool(null)
  }

  const addLowerThird = (): void => {
    if (!edit) return
    const id = newId()
    commit(addOverlay(edit, { id, kind: 'lowerThird', ...newSpan(edit, timeMs), title: 'Title', subtitle: 'Subtitle' }))
    setSelection({ kind: 'overlay', id })
    setTool(null)
  }

  return (
    <div className="editor">
      <div className="editor-top">
        <button className="btn" onClick={onBack}>
          ← Library
        </button>
        <h1>{opened?.manifest.title ?? 'Opening…'}</h1>
        <button className="btn primary" onClick={() => runExport('mp4')} disabled={!edit || (!!exporting && 'pct' in exporting)}>
          Export MP4
        </button>
        <button className="btn" onClick={() => runExport('gif')} disabled={!edit || (!!exporting && 'pct' in exporting)}>
          Export GIF
        </button>
        <button className="btn" onClick={undo} disabled={!history.current?.canUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button className="btn" onClick={redo} disabled={!history.current?.canRedo} title="Redo (Ctrl+Y)">
          Redo
        </button>
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {exporting && 'pct' in exporting && (
        <div className="progress" role="progressbar" aria-label="Export progress" aria-valuenow={exporting.pct}>
          <div style={{ width: `${exporting.pct}%` }} />
        </div>
      )}
      {exporting && 'done' in exporting && (
        <div className="banner" role="status" data-testid="export-done">
          Exported to {exporting.done}{' '}
          <button className="btn" onClick={() => window.leverage['shell:showInFolder']((exporting as { done: string }).done)}>
            Show in Explorer
          </button>
        </div>
      )}
      {exporting && 'error' in exporting && (
        <div className="banner error" role="alert">
          Export failed: {exporting.error}
        </div>
      )}
      {saveError && (
        <div className="banner error" role="alert">
          Edits could not be saved: {saveError}
        </div>
      )}
      {opened?.repaired && (
        <div className="banner warning" role="status">
          This recording&apos;s saved edits could not be read completely, so some were reset.
        </div>
      )}
      {opened && edit && frame && (
        <>
          <div className="editor-tools" role="toolbar" aria-label="Add overlay">
            {(
              [
                ['blur', 'Blur'],
                ['arrow', 'Arrow'],
                ['box', 'Box'],
                ['text', 'Text']
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                className={tool === t ? 'btn active' : 'btn'}
                aria-pressed={tool === t}
                onClick={() => setTool(tool === t ? null : t)}
              >
                {label}
              </button>
            ))}
            <button className="btn" onClick={addLowerThird}>
              Lower third
            </button>
            {tool && <span className="muted">Draw on the preview · Esc to cancel</span>}
          </div>
          <div className="editor-main">
            <Preview
              ref={preview}
              manifest={opened.manifest}
              frame={frame}
              edit={edit}
              urls={urls}
              belowCanvas={(scale) => <BlurLayer overlays={edit.overlays} srcMs={srcMs} scale={scale} />}
              stageChildren={(scale) => (
                <OverlayLayer
                  overlays={edit.overlays}
                  frame={frame}
                  scale={scale}
                  srcMs={srcMs}
                  tool={tool}
                  selectedId={selectedOverlay?.id ?? null}
                  onCreate={createOverlay}
                  onSelect={(id) => setSelection(id ? { kind: 'overlay', id } : null)}
                  onRect={(id, rect) => commit(updateOverlay(edit, id, { rect } as Partial<Overlay>))}
                  camera={urls.camera ? edit.camera : null}
                  onCamera={(c) => commit(setCamera(edit, c))}
                />
              )}
            />
            {!selectedOverlay && urls.camera && edit.camera && (
              <CameraPanel camera={edit.camera} frame={frame} onChange={(patch) => commit(setCamera(edit, patch))} />
            )}
            {selectedOverlay && (
              <Inspector
                edit={edit}
                overlay={selectedOverlay}
                onChange={(patch) => commit(updateOverlay(edit, selectedOverlay.id, patch))}
                onDelete={() => {
                  commit(removeOverlay(edit, selectedOverlay.id))
                  setSelection(null)
                }}
              />
            )}
          </div>
          <div className="transport">
            <button className="btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="transport-time" data-testid="time">
              {clock(timeMs)} / {clock(total)}
            </span>
            <input
              className="scrubber"
              type="range"
              min={0}
              max={total}
              step={10}
              value={timeMs}
              aria-label="Playhead"
              onChange={(e) => seek(Number(e.target.value))}
            />
          </div>
          <Timeline
            edit={edit}
            timeMs={timeMs}
            selection={selection}
            mark={mark}
            zoomMsPerPx={zoom}
            onSeek={seek}
            onSelect={setSelection}
            onMoveClip={(id, to) => commit(moveClip(edit, id, to))}
            onZoom={setZoom}
            lanes={(msPerPx) => (
              <>
              <OverlayLane
                edit={edit}
                msPerPx={msPerPx}
                selectedId={selectedOverlay?.id ?? null}
                onSelect={(id) => setSelection({ kind: 'overlay', id })}
                onSpan={(id, srcStartMs, srcEndMs) => commit(updateOverlay(edit, id, { srcStartMs, srcEndMs }))}
              />
              </>
            )}
          />
          <AudioLanes
            edit={edit}
            tracks={(['mic', 'system'] as const).filter((t) => urls[t])}
            onMuted={(t, m) => commit(setMuted(edit, t, m))}
            onGain={(t, g) => commit(setGain(edit, t, g))}
          />
        </>
      )}
    </div>
  )
}
