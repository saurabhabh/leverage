import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { outputDurationMs, relativeOffsets, type EditDoc } from '../../../shared/edit'
import type { OpenedEdit } from '../../../shared/ipc'
import type { Size, TrackKind } from '../../../shared/types'
import Preview, { type PreviewHandle } from './Preview'
import { PlaybackController } from './player'
import './editor.css'

type Props = { recordingId: string; onBack: () => void }

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)

export const clock = (ms: number): string => {
  const tenths = Math.floor(ms / 100)
  const s = Math.floor(tenths / 10)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${tenths % 10}`
}

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

export default function Editor({ recordingId, onBack }: Props): React.JSX.Element {
  const [opened, setOpened] = useState<OpenedEdit | null>(null)
  const [edit, setEdit] = useState<EditDoc | null>(null)
  const [urls, setUrls] = useState<Partial<Record<TrackKind, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [timeMs, setTimeMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const preview = useRef<PreviewHandle>(null)
  const player = useRef<PlaybackController | null>(null)

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
        setEdit(o.edit)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [recordingId])

  const frame: Size | null = useMemo(() => {
    if (!opened) return null
    const s = opened.manifest.crop ?? opened.manifest.videoSize
    return { width: even(s.width), height: even(s.height) }
  }, [opened])

  // One controller per opened recording, created once the media elements exist.
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
    if (edit) player.current?.setEdit(edit)
  }, [edit, opened])

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
      if (isTyping(e.target)) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') seek((player.current?.timeMs ?? 0) - 1000)
      else if (e.key === 'ArrowRight') seek((player.current?.timeMs ?? 0) + 1000)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seek])

  const total = edit ? outputDurationMs(edit) : 0

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
      {opened && edit && frame && (
        <>
          <Preview ref={preview} manifest={opened.manifest} frame={frame} edit={edit} urls={urls} />
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
        </>
      )}
    </div>
  )
}
