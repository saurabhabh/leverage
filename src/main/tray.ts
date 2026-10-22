import { app, Menu, nativeImage, Tray } from 'electron'
import type { RecorderCommand, RecorderStatus } from '../shared/ipc'

let tray: Tray | null = null

type TrayActions = { command: (c: RecorderCommand) => void; open: () => void; snap: () => void; dictate: () => void }

export function createTray(icon: string, actions: TrayActions): void {
  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }))
  tray.setToolTip('Leverage')
  tray.on('click', actions.open)
  updateTray({ phase: 'idle', elapsedMs: 0 }, actions)
}

export function updateTray(status: RecorderStatus, actions: TrayActions): void {
  if (!tray) return
  const active = status.phase === 'recording' || status.phase === 'paused'
  tray.setToolTip(active ? `Leverage — ${status.phase}` : 'Leverage')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: active ? 'Stop recording' : 'Start recording', click: () => actions.command('toggle') },
      {
        label: status.phase === 'paused' ? 'Resume' : 'Pause',
        enabled: active,
        click: () => actions.command('pause')
      },
      { label: 'Abort recording', enabled: active, click: () => actions.command('abort') },
      { type: 'separator' },
      { label: 'Take screenshot', click: actions.snap },
      { label: 'Dictate', click: actions.dictate },
      { type: 'separator' },
      { label: 'Open Leverage', click: actions.open },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
}
