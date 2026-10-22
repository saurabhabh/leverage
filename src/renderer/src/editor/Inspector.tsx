import { sourceToOutput, type EditDoc, type Overlay } from '../../../shared/edit'
import { SWATCHES } from './overlayGeometry'
import { clock } from './time'

type Props = {
  edit: EditDoc
  overlay: Overlay
  onChange: (patch: Partial<Overlay>) => void
  onDelete: () => void
}

const TITLE: Record<Overlay['kind'], string> = {
  blur: 'Blur',
  arrow: 'Arrow',
  box: 'Box',
  text: 'Text',
  lowerThird: 'Lower third'
}

/** Properties of the selected overlay. Text edits apply as you type. */
export default function Inspector({ edit, overlay: o, onChange, onDelete }: Props): React.JSX.Element {
  const shown = sourceToOutput(edit, o.srcStartMs, o.srcEndMs)
  return (
    <aside className="inspector card" aria-label="Overlay properties">
      <div className="inspector-head">
        <strong>{TITLE[o.kind]}</strong>
        <span className="muted">
          {shown.length
            ? shown.map((iv) => `${clock(iv.outStartMs)}–${clock(iv.outEndMs)}`).join(', ')
            : 'Not in the edit (its part was cut)'}
        </span>
      </div>

      {o.kind === 'text' && (
        <label className="field">
          <span>Text</span>
          <input aria-label="Text" value={o.text} onChange={(e) => onChange({ text: e.target.value })} />
        </label>
      )}
      {(o.kind === 'arrow' || o.kind === 'box') && (
        <label className="field">
          <span>Label (optional)</span>
          <input aria-label="Label" value={o.text} onChange={(e) => onChange({ text: e.target.value })} />
        </label>
      )}
      {o.kind === 'lowerThird' && (
        <>
          <label className="field">
            <span>Title</span>
            <input aria-label="Title" value={o.title} onChange={(e) => onChange({ title: e.target.value })} />
          </label>
          <label className="field">
            <span>Subtitle</span>
            <input aria-label="Subtitle" value={o.subtitle} onChange={(e) => onChange({ subtitle: e.target.value })} />
          </label>
        </>
      )}
      {(o.kind === 'arrow' || o.kind === 'box' || o.kind === 'text') && (
        <div className="field">
          <span>Colour</span>
          <div className="swatches">
            {SWATCHES.map((c) => (
              <button
                key={c}
                className={c === o.color ? 'swatch selected' : 'swatch'}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                onClick={() => onChange({ color: c })}
              />
            ))}
          </div>
        </div>
      )}
      {o.kind === 'blur' && (
        <label className="field">
          <span>Blur strength</span>
          <input
            type="range"
            aria-label="Blur strength"
            min={1}
            max={20}
            value={o.strength}
            onChange={(e) => onChange({ strength: Number(e.target.value) })}
          />
        </label>
      )}
      <button className="btn" onClick={onDelete} aria-label="Delete overlay">
        Delete
      </button>
    </aside>
  )
}
