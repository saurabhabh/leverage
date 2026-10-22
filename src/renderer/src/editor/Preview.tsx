import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { EditDoc } from '../../../shared/edit'
import type { RecordingManifest, Size, TrackKind } from '../../../shared/types'
import type { MediaLike } from './player'

export type PreviewHandle = {
  media: () => Partial<Record<TrackKind, MediaLike>>
  /** Display px per output-frame px. */
  scale: () => number
  overlayCanvas: () => HTMLCanvasElement | null
  stage: () => HTMLDivElement | null
}

type Props = {
  manifest: RecordingManifest
  frame: Size
  edit: EditDoc
  urls: Partial<Record<TrackKind, string>>
  children?: React.ReactNode
  /** Rendered inside the stage, in display px (overlay handles, camera drag, etc.). */
  stageChildren?: (scale: number) => React.ReactNode
}

/**
 * The frame as it will be exported: the screen (cropped) scaled to fit, the camera circle where the
 * edit puts it, and a canvas for callouts/lower-thirds. Mic and system audio are hidden <audio>.
 */
const Preview = forwardRef<PreviewHandle, Props>(function Preview({ manifest, frame, edit, urls, stageChildren }, ref) {
  const outer = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const els = useRef<Partial<Record<TrackKind, HTMLMediaElement | null>>>({})
  const [scale, setScale] = useState(0.5)

  useLayoutEffect(() => {
    const el = outer.current
    if (!el) return
    const fit = (): void => {
      const s = Math.min(el.clientWidth / frame.width, el.clientHeight / frame.height)
      setScale(Number.isFinite(s) && s > 0 ? s : 0.5)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [frame.width, frame.height])

  useImperativeHandle(ref, () => ({
    media: () => {
      const out: Partial<Record<TrackKind, MediaLike>> = {}
      for (const [k, v] of Object.entries(els.current)) if (v) out[k as TrackKind] = v
      return out
    },
    scale: () => scale,
    overlayCanvas: () => canvas.current,
    stage: () => stage.current
  }))

  const crop = manifest.crop ?? { x: 0, y: 0, ...manifest.videoSize }
  // Screen video is laid out at full captured size and shifted so the crop fills the stage.
  const sx = (frame.width / crop.width) * scale
  const sy = (frame.height / crop.height) * scale
  const cam = edit.camera

  return (
    <div className="preview-frame" ref={outer}>
      <div
        className="preview-stage"
        ref={stage}
        style={{ width: frame.width * scale, height: frame.height * scale }}
      >
        {urls.screen && (
          <video
            data-testid="preview-screen"
            ref={(v) => {
              els.current.screen = v
            }}
            src={urls.screen}
            preload="auto"
            muted
            style={{
              left: -crop.x * sx,
              top: -crop.y * sy,
              width: manifest.videoSize.width * sx,
              height: manifest.videoSize.height * sy
            }}
          />
        )}
        {urls.camera && cam && (
          <div
            data-testid="preview-camera"
            className="preview-camera"
            hidden={!cam.visible}
            style={{ left: cam.x * scale, top: cam.y * scale, width: cam.size * scale, height: cam.size * scale }}
          >
            <video
              ref={(v) => {
                els.current.camera = v
              }}
              src={urls.camera}
              preload="auto"
              muted
            />
          </div>
        )}
        <canvas
          ref={canvas}
          className="preview-overlays"
          width={Math.round(frame.width * scale)}
          height={Math.round(frame.height * scale)}
        />
        {stageChildren?.(scale)}
      </div>
      {(['mic', 'system'] as const).map(
        (k) =>
          urls[k] && (
            <audio
              key={k}
              data-testid={`preview-${k}`}
              ref={(a) => {
                els.current[k] = a
              }}
              src={urls[k]}
              preload="auto"
            />
          )
      )}
    </div>
  )
})

export default Preview
