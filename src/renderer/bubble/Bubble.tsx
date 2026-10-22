import { useEffect, useRef, useState } from 'react'

const cameraId = new URLSearchParams(location.search).get('cameraId') ?? ''

/** Circular, mirrored camera preview. Drag to move; hover for S / M / L. */
export default function Bubble(): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: cameraId }, width: { ideal: 640 }, height: { ideal: 480 } } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (video.current) video.current.srcObject = s
      })
      .catch(() => setError('Camera unavailable'))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="bubble">
      {error ? <div className="error">{error}</div> : <video ref={video} autoPlay muted playsInline />}
      <div className="sizes">
        {(['S', 'M', 'L'] as const).map((s) => (
          <button key={s} onClick={() => void window.leverage['bubble:resize'](s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
