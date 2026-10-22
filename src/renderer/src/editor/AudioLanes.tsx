import type { EditDoc } from '../../../shared/edit'

type Track = 'mic' | 'system'
const LABEL: Record<Track, string> = { mic: 'Mic', system: 'System audio' }

type Props = {
  edit: EditDoc
  tracks: Track[]
  onMuted: (t: Track, muted: boolean) => void
  onGain: (t: Track, gain: number) => void
}

/** One row per recorded audio track: mute and level (0–200 %; above 100 % applies on export). */
export default function AudioLanes({ edit, tracks, onMuted, onGain }: Props): React.JSX.Element | null {
  if (tracks.length === 0) return null
  return (
    <div className="audio-lanes">
      {tracks.map((t) => {
        const name = LABEL[t].toLowerCase()
        const muted = edit.muted[t]
        return (
          <div key={t} className={muted ? 'audio-lane muted' : 'audio-lane'}>
            <span className="audio-name">{LABEL[t]}</span>
            <button
              className="btn"
              aria-label={muted ? `Unmute ${name}` : `Mute ${name}`}
              onClick={() => onMuted(t, !muted)}
            >
              {muted ? 'Muted' : 'Mute'}
            </button>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              aria-label={`${LABEL[t]} volume`}
              value={Math.round(edit.gains[t] * 100)}
              onChange={(e) => onGain(t, Number(e.target.value) / 100)}
            />
            <span className="muted audio-level">{Math.round(edit.gains[t] * 100)}%</span>
          </div>
        )
      })}
    </div>
  )
}
