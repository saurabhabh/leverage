import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchIsolated } from './launch'

async function launchSnap(): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  const dir = join(mkdtempSync(join(tmpdir(), 'lev-snap-')), 'Shots')
  const { app } = await launchIsolated({ snap: { dir, hotkey: 'CommandOrControl+Shift+2' } })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, dir }
}

const pngSize = (
  app: ElectronApplication,
  file: string
): Promise<{ width: number; height: number }> =>
  app.evaluate(({ nativeImage }, f) => nativeImage.createFromPath(f).getSize(), file)

/** Drag on the overlay inside one synchronous burst, so a real mouse cannot interleave. */
async function dragOn(
  overlay: Page,
  from: [number, number],
  to: [number, number]
): Promise<string | null | undefined> {
  return overlay.evaluate(
    async ([a, b]) => {
      const el = document.querySelector('.snap-overlay')!
      const fire = (type: string, x: number, y: number): boolean =>
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }))
      fire('mousedown', a[0], a[1])
      fire('mousemove', b[0], b[1])
      let text: string | null | undefined
      for (let i = 0; i < 30 && !text; i++) {
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        text = document.querySelector('.size')?.textContent
      }
      fire('mouseup', b[0], b[1])
      return text
    },
    [from, to] as const
  )
}

/** Keys that end the session close the window before a key-up could be delivered: press down only. */
async function finalKey(overlay: Page, ...keys: string[]): Promise<void> {
  for (const k of keys) await overlay.keyboard.down(k)
}

async function openOverlay(app: ElectronApplication, page: Page): Promise<Page> {
  const overlayPromise = app.waitForEvent('window', (w) => w.url().includes('snap-overlay.html'))
  void page.evaluate(() => window.leverage['snap:capture']('region'))
  const overlay = await overlayPromise
  await overlay.waitForLoadState('domcontentloaded')
  await expect(overlay.getByText('Drag to select')).toBeVisible({ timeout: 15_000 })
  // The frozen screen is painted before the window is shown.
  await expect
    .poll(() =>
      app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length
      )
    )
    .toBeGreaterThan(0)
  return overlay
}

test('region capture: select, Enter → a PNG of exactly the selected pixels, opened in the editor', async () => {
  const { app, page, dir } = await launchSnap()
  const overlay = await openOverlay(app, page)
  expect(await dragOn(overlay, [100, 80], [250, 160])).toMatch(/^\d+ × \d+$/)
  // Arrow keys nudge, Ctrl+arrow resizes (Flameshot keys).
  await overlay.keyboard.press('Control+ArrowRight')
  await finalKey(overlay, 'Enter')

  await expect
    .poll(() => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : []))
    .toHaveLength(1)
  const [file] = readdirSync(dir).filter((f) => f.endsWith('.png'))
  const scale = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor)
  expect(await pngSize(app, join(dir, file))).toEqual({
    width: Math.ceil(151 * scale),
    height: Math.ceil(80 * scale)
  })
  await expect(page.getByTestId('snap-editor')).toBeVisible()
  await app.close()
})

test('Esc cancels without saving anything', async () => {
  const { app, page, dir } = await launchSnap()
  const overlay = await openOverlay(app, page)
  await dragOn(overlay, [10, 10], [60, 60])
  const closed = overlay.waitForEvent('close')
  await finalKey(overlay, 'Escape')
  await closed
  expect(existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : []).toEqual([])
  await app.close()
})

test('Ctrl+C from the overlay copies the shot to the clipboard and keeps it in the gallery', async () => {
  const { app, page, dir } = await launchSnap()
  const overlay = await openOverlay(app, page)
  await dragOn(overlay, [20, 20], [120, 70])
  await finalKey(overlay, 'Control', 'c')
  await expect
    .poll(() => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).length : 0))
    .toBe(1)
  await expect
    .poll(() =>
      app.evaluate(async ({ clipboard }) =>
        (await clipboard.read()).some((i) => i.types.includes('image/png'))
      )
    )
    .toBe(true)
  await app.close()
})
