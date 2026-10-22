import { useState } from 'react'

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

  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">Leverage</div>
        {MODULES.map((m) => (
          <button
            key={m}
            className={m === active ? 'nav-item active' : 'nav-item'}
            onClick={() => setActive(m)}
          >
            {m}
          </button>
        ))}
      </nav>
      <main className="content">
        {active === 'Studio' && <ComingSoon name="Studio" />}
        {active === 'Snap' && <ComingSoon name="Snap" />}
        {active === 'Listen' && <ComingSoon name="Listen" />}
        {active === 'Library' && <ComingSoon name="Library" />}
        {active === 'Settings' && <ComingSoon name="Settings" />}
      </main>
    </div>
  )
}

export default App
