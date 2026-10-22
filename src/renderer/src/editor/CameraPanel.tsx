import type { CameraSettings } from '../../../shared/edit'
import type { Size } from '../../../shared/types'
import { CAMERA_PRESETS, clampCamera } from './overlayGeometry'

type Props = { camera: CameraSettings; frame: Size; onChange: (patch: Partial<CameraSettings>) => void }

/** Shown when nothing is selected: the camera circle's visibility and size. */
export default function CameraPanel({ camera, frame, onChange }: Props): React.JSX.Element {
  const preset = (k: keyof typeof CAMERA_PRESETS): void => {
    const size = frame.width * CAMERA_PRESETS[k]
    // Grow/shrink around the circle's centre, then keep it inside the frame.
    const cx = camera.x + camera.size / 2
    const cy = camera.y + camera.size / 2
    onChange(clampCamera({ x: cx - size / 2, y: cy - size / 2, size }, frame))
  }
  return (
    <aside className="inspector card" aria-label="Camera">
      <div className="inspector-head">
        <strong>Camera</strong>
        <span className="muted">Drag the circle on the preview to move it.</span>
      </div>
      <label className="field row-field">
        <input
          type="checkbox"
          aria-label="Show camera"
          checked={camera.visible}
          onChange={(e) => onChange({ visible: e.target.checked })}
        />
        <span>Show camera</span>
      </label>
      <div className="field">
        <span>Size</span>
        <div className="swatches">
          {(Object.keys(CAMERA_PRESETS) as (keyof typeof CAMERA_PRESETS)[]).map((k) => (
            <button key={k} className="btn" aria-label={`Camera size ${k}`} onClick={() => preset(k)} disabled={!camera.visible}>
              {k}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
