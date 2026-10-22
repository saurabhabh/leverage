import { useEffect, useState } from 'react'
import Settings from './settings/Settings'
import Studio from './studio/Studio'
import Library from './library/Library'
import Editor from './editor/Editor'
import Snap from './snap/Snap'
import Listen from './listen/Listen'

type Module = 'Studio' | 'Snap' | 'Listen' | 'Library' | 'Settings'

const MODULES: Module[] = ['Studio', 'Snap', 'Listen', 'Library', 'Settings']

function App(): React.JSX.Element {
  const [active, setActive] = useState<Module>('Studio')
  const [editing, setEditing] = useState<string | null>(null)
  const [snapEditing, setSnapEditing] = useState<string | null>(null)

  // A capture accepted with Enter opens straight in the Snap editor.
  useEffect(
    () =>
      window.leverage.on('snap:open', ({ id }) => {
        setSnapEditing(id)
        setActive('Snap')
      }),
    []
  )

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
              setSnapEditing(null)
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
        {active === 'Snap' && <Snap editing={snapEditing} onEdit={setSnapEditing} />}
        {active === 'Listen' && <Listen />}
        {active === 'Library' && !editing && (
          <Library
            onEdit={setEditing}
            onEditSnap={(id) => {
              setSnapEditing(id)
              setActive('Snap')
            }}
          />
        )}
        {active === 'Library' && editing && (
          <Editor recordingId={editing} onBack={() => setEditing(null)} />
        )}
        {active === 'Settings' && <Settings />}
      </main>
    </div>
  )
}

export default App
