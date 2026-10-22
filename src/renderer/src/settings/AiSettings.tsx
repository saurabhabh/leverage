import { useEffect, useState } from 'react'
import type { Settings } from '../../../shared/types'

type Provider = 'groq' | 'openrouter'
const NAME: Record<Provider, string> = { groq: 'Groq', openrouter: 'OpenRouter' }

function KeyField({ provider, saved, onSaved }: { provider: Provider; saved: boolean; onSaved: () => void }): React.JSX.Element {
  const [value, setValue] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const name = NAME[provider]
  const save = async (): Promise<void> => {
    try {
      await window.leverage['ai:setKey'](provider, value)
      setValue('')
      setMessage(value.trim() ? `${name} key saved ✓` : `${name} key removed`)
      onSaved()
    } catch (err) {
      setMessage(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
  }
  return (
    <div className="row">
      <label htmlFor={`key-${provider}`}>{name} API key</label>
      <input
        id={`key-${provider}`}
        className="text-input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={saved ? 'Saved — type to replace, or save empty to remove' : 'Paste your key'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
      />
      <button className="btn" aria-label={`Save ${name} key`} onClick={save}>
        Save
      </button>
      {message && <span className="muted">{message}</span>}
    </div>
  )
}

/** Engines, providers, models and keys. Keys are write-only: the app can never show them again. */
export default function AiSettings({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const [keys, setKeys] = useState({ groq: false, openrouter: false })
  const refreshKeys = (): void => void window.leverage['ai:hasKeys']().then(setKeys)
  useEffect(refreshKeys, [])
  const ai = settings.ai
  const setAi = (patch: Partial<Settings['ai']>): void => update({ ai: { ...ai, ...patch } })
  const [models, setModels] = useState({ groq: ai.groqChatModel, openrouter: ai.openrouterModel })
  useEffect(() => setModels({ groq: ai.groqChatModel, openrouter: ai.openrouterModel }), [ai.groqChatModel, ai.openrouterModel])

  return (
    <section className="card">
      <h2>Transcription &amp; AI</h2>
      <p className="muted">Keys are stored encrypted on this PC and only sent to that provider.</p>

      <div className="row" role="radiogroup" aria-label="Transcription engine">
        <label>Transcription engine</label>
        <label className="choice">
          <input type="radio" name="engine" checked={ai.transcription === 'local'} onChange={() => setAi({ transcription: 'local' })} />
          Local (free, private)
        </label>
        <label className="choice">
          <input type="radio" name="engine" checked={ai.transcription === 'groq'} onChange={() => setAi({ transcription: 'groq' })} />
          Groq (cloud)
        </label>
      </div>

      <div className="row">
        <label htmlFor="suggest-provider">Suggestions provider</label>
        <select
          id="suggest-provider"
          value={ai.suggestions}
          onChange={(e) => setAi({ suggestions: e.target.value as Provider })}
        >
          <option value="groq">Groq</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </div>

      <div className="row">
        <label htmlFor="groq-model">Groq model</label>
        <input
          id="groq-model"
          className="text-input"
          value={models.groq}
          onChange={(e) => setModels({ ...models, groq: e.target.value })}
          onBlur={() => models.groq.trim() && setAi({ groqChatModel: models.groq.trim() })}
        />
      </div>
      <div className="row">
        <label htmlFor="openrouter-model">OpenRouter model</label>
        <input
          id="openrouter-model"
          className="text-input"
          value={models.openrouter}
          onChange={(e) => setModels({ ...models, openrouter: e.target.value })}
          onBlur={() => models.openrouter.trim() && setAi({ openrouterModel: models.openrouter.trim() })}
        />
      </div>

      <KeyField provider="groq" saved={keys.groq} onSaved={refreshKeys} />
      <KeyField provider="openrouter" saved={keys.openrouter} onSaved={refreshKeys} />
    </section>
  )
}
