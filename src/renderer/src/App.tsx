import { useState } from 'react'
import Settings from './settings/Settings'
import Studio from './studio/Studio'
import Library from './library/Library'
import Editor from './editor/Editor'

type Module = 'Studio' | 'Snap' | 'Listen' | 'Library' | 'Settings'

const MODULES: Module[] = ['Studio', 'Snap', 'Listen', 'Library', 'Settings']

function ComingSoon({ name }: { name: string }): React.JSX.Element {
  return (
    <div className="placeholder">
      <h1>{name}</h1>
      <p>Coming soon</p>
    </div>
  )
}

function App(): React.JSX.Element {
  const [active, setActive] = useState<Module>('Studio')
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">Leverage</div>
        {MODULES.map((m) => (
          <button
            key={m}
            className={m === active ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setEditing(null)
              setActive(m)
            }}
          >
            {m}
          </button>
        ))}
      </nav>
      <main className="content">
        {/* Studio stays mounted so a recording keeps running while other pages are open. */}
        <div hidden={active !== 'Studio'}>
          <Studio />
        </div>
        {active === 'Snap' && <ComingSoon name="Snap" />}
        {active === 'Listen' && <ComingSoon name="Listen" />}
        {active === 'Library' && !editing && <Library onEdit={setEditing} />}
        {active === 'Library' && editing && <Editor recordingId={editing} onBack={() => setEditing(null)} />}
        {active === 'Settings' && <Settings />}
      </main>
    </div>
  )
}

export default App
