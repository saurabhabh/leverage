import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
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
      // Down, move and up with no await in between, so the real pointer cannot interleave a move.
      fire('mousedown', a[0], a[1])
      fire('mousemove', b[0], b[1])
      fire('mouseup', b[0], b[1])
      let text: string | null | undefined
      for (let i = 0; i < 30 && !text; i++) {
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        text = document.querySelector('.size')?.textContent
      }
      return text
    },
    [from, to] as const
  )
}

/** Keys that end the session close the window before a key-up could be delivered: press down only. */
async function finalKey(overlay: Page, ...keys: string[]): Promise<void> {
  // The window may close before even the key-down is acknowledged; the test checks the outcome.
  for (const k of keys) await overlay.keyboard.down(k).catch(() => undefined)
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

/** A 400×300 shot: left half blue, right half orange, written the way SnapStore lays it out. */
async function seedShot(
  app: ElectronApplication,
  dir: string,
  id = '2026-10-22_14-05-09'
): Promise<string> {
  const b64 = await app.evaluate(({ nativeImage }) => {
    const w = 400
    const h = 300
    const bgra = Buffer.alloc(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const left = i % w < w / 2
      bgra.set(left ? [200, 80, 20, 255] : [20, 140, 240, 255], i * 4)
    }
    return nativeImage.createFromBitmap(bgra, { width: w, height: h }).toPNG().toString('base64')
  })
  const png = Buffer.from(b64, 'base64')
  const side = join(dir, '.leverage', id)
  mkdirSync(side, { recursive: true })
  writeFileSync(join(dir, `${id}.png`), png)
  writeFileSync(join(side, 'original.png'), png)
  const doc = {
    version: 1,
    id,
    file: `${id}.png`,
    createdAt: new Date().toISOString(),
    width: 400,
    height: 300,
    shapes: []
  }
  writeFileSync(join(side, 'snap.json'), JSON.stringify(doc))
  return id
}

const docOf = (
  dir: string,
  id: string
): { shapes: { kind: string; [k: string]: unknown }[]; crop?: unknown } =>
  JSON.parse(readFileSync(join(dir, '.leverage', id, 'snap.json'), 'utf8'))

async function openSeeded(): Promise<{
  app: ElectronApplication
  page: Page
  dir: string
  id: string
}> {
  const { app, page, dir } = await launchSnap()
  const id = await seedShot(app, dir)
  await page.getByRole('button', { name: 'Snap', exact: true }).click()
  await expect(page.getByTestId('snap-tile')).toHaveCount(1)
  await page.getByTestId('snap-tile').getByTitle('Open in the editor').click()
  await expect(page.getByTestId('snap-canvas')).toBeVisible()
  return { app, page, dir, id }
}

/** Drag on the editor canvas in image pixels (the canvas may be shown scaled). */
async function dragImage(
  page: Page,
  from: [number, number],
  to: [number, number],
  opts: { shift?: boolean } = {}
): Promise<void> {
  const box = (await page.getByTestId('snap-canvas').boundingBox())!
  const s = box.width / 400
  if (opts.shift) await page.keyboard.down('Shift')
  await page.mouse.move(box.x + from[0] * s, box.y + from[1] * s)
  await page.mouse.down()
  await page.mouse.move(box.x + ((from[0] + to[0]) / 2) * s, box.y + ((from[1] + to[1]) / 2) * s)
  await page.mouse.move(box.x + to[0] * s, box.y + to[1] * s)
  await page.mouse.up()
  if (opts.shift) await page.keyboard.up('Shift')
}

async function clickImage(page: Page, at: [number, number]): Promise<void> {
  const box = (await page.getByTestId('snap-canvas').boundingBox())!
  const s = box.width / 400
  await page.mouse.click(box.x + at[0] * s, box.y + at[1] * s)
}

const saved = (page: Page): Promise<void> => expect(page.getByRole('status')).toHaveText('Saved')

test('editor: draw, autosave, undo/redo, select + Delete', async () => {
  const { app, page, dir, id } = await openSeeded()
  await page.getByRole('button', { name: 'Rectangle' }).click()
  await dragImage(page, [50, 40], [150, 120])
  await expect.poll(() => docOf(dir, id).shapes.length).toBe(1)
  await saved(page)
  const rect = docOf(dir, id).shapes[0] as {
    kind: string
    rect: { x: number; y: number; width: number; height: number }
  }
  expect(rect.kind).toBe('rect')
  expect(rect.rect.x).toBeCloseTo(50, 0)
  expect(rect.rect.width).toBeCloseTo(100, 0)
  // The visible PNG now differs from the untouched original.
  expect(
    readFileSync(join(dir, `${id}.png`)).equals(
      readFileSync(join(dir, '.leverage', id, 'original.png'))
    )
  ).toBe(false)

  await page.keyboard.press('Control+z')
  await expect.poll(() => docOf(dir, id).shapes.length).toBe(0)
  await page.keyboard.press('Control+y')
  await expect.poll(() => docOf(dir, id).shapes.length).toBe(1)

  await page.keyboard.press('v')
  await clickImage(page, [100, 80])
  await page.keyboard.press('Delete')
  await expect.poll(() => docOf(dir, id).shapes.length).toBe(0)
  await app.close()
})

test('editor: Shift snaps an arrow to 45°, text and numbered steps, keyboard tool switching', async () => {
  const { app, page, dir, id } = await openSeeded()
  await page.keyboard.press('a')
  await dragImage(page, [20, 20], [200, 35], { shift: true })
  await expect.poll(() => docOf(dir, id).shapes.length).toBe(1)
  const arrow = docOf(dir, id).shapes[0] as { a: { y: number }; b: { y: number } }
  expect(arrow.b.y).toBeCloseTo(arrow.a.y, 5)

  await page.keyboard.press('t')
  await clickImage(page, [60, 200])
  await page.getByLabel('Text').fill('Hello')
  await page.keyboard.press('Enter')
  await page.keyboard.press('n')
  await clickImage(page, [300, 50])
  await clickImage(page, [300, 150])
  await expect
    .poll(() => docOf(dir, id).shapes.map((s) => s.kind))
    .toEqual(['arrow', 'text', 'counter', 'counter'])
  expect(docOf(dir, id).shapes[1]).toMatchObject({ text: 'Hello' })
  await app.close()
})

test('editor: pixelate renders, crop changes the exported PNG and can be reset', async () => {
  const { app, page, dir, id } = await openSeeded()
  await page.keyboard.press('b')
  await dragImage(page, [150, 100], [250, 200])
  await expect.poll(() => docOf(dir, id).shapes.map((s) => s.kind)).toEqual(['pixelate'])
  await page.keyboard.press('c')
  await dragImage(page, [100, 50], [300, 250])
  await expect.poll(() => docOf(dir, id).crop).toBeTruthy()
  await saved(page)
  expect(await pngSize(app, join(dir, `${id}.png`))).toEqual({ width: 200, height: 200 })
  await page.getByRole('button', { name: 'Reset crop' }).click()
  await expect.poll(() => docOf(dir, id).crop).toBeUndefined()
  await saved(page)
  expect(await pngSize(app, join(dir, `${id}.png`))).toEqual({ width: 400, height: 300 })
  await app.close()
})

test('gallery and Library list the shot; copy, save as (never overwriting) and pin work', async () => {
  const { app, page, dir, id } = await openSeeded()
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Copied to clipboard')
  const types = await app.evaluate(async ({ clipboard }) =>
    (await clipboard.read()).flatMap((i) => i.types)
  )
  expect(types).toContain('image/png')

  const out = join(dir, '..', 'exported.png')
  const first = await page.evaluate(([i, o]) => window.leverage['snap:saveAs'](i, o), [
    id,
    out
  ] as const)
  const second = await page.evaluate(([i, o]) => window.leverage['snap:saveAs'](i, o), [
    id,
    out
  ] as const)
  expect(first).toBe(out)
  expect(second).toBe(join(dir, '..', 'exported (2).png'))

  const pinPromise = app.waitForEvent('window', (w) => w.url().includes('pin.html'))
  await page.getByRole('button', { name: 'Pin', exact: true }).click()
  const pin = await pinPromise
  await expect(pin.getByAltText('Pinned screenshot')).toBeVisible()
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (w) => w.isAlwaysOnTop() && w.getTitle() === 'Leverage pin'
      )
    )
  ).toBe(true)
  const closed = pin.waitForEvent('close')
  await pin.keyboard.down('Escape').catch(() => undefined)
  await closed

  await page.getByRole('button', { name: '← Snap' }).click()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('tab', { name: 'Screenshots' }).click()
  await expect(page.getByTestId('snap-tile')).toHaveCount(1)
  await app.close()
})
