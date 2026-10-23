import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchIsolated } from './launch'

async function tempLibrary(page: Page): Promise<string> {
  const library = join(mkdtempSync(join(tmpdir(), 'lev-helpers-')), 'Library')
  await page.evaluate(async (libraryDir) => {
    const s = await window.leverage['settings:get']()
    await window.leverage['settings:set']({ ...s, libraryDir, countdownSec: 0 })
  }, library)
  return library
}

test('hotkeys are registered globally', async () => {
  const { app } = await launchIsolated()
  await app.firstWindow()
  const registered = await app.evaluate(({ globalShortcut }) =>
    ['CommandOrControl+Shift+R', 'CommandOrControl+Shift+P', 'CommandOrControl+Shift+X'].map((a) =>
      globalShortcut.isRegistered(a)
    )
  )
  expect(registered).toEqual([true, true, true])
  await app.close()
})

test('toolbar appears while recording and its Pause and Stop control the recorder', async () => {
  const { app } = await launchIsolated()
  const page = await app.firstWindow()
  const library = await tempLibrary(page)

  await page.getByRole('button', { name: 'Studio' }).click()
  await expect(page.locator('.source').first()).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Camera').selectOption('')
  await page.getByLabel('Microphone').selectOption('')
  await page.getByLabel('System audio').uncheck()

  const toolbarPromise = app.waitForEvent('window', (w) => w.url().includes('toolbar.html'))
  await page.getByRole('button', { name: '● Record' }).click()
  const toolbar = await toolbarPromise
  await expect(toolbar.getByLabel('Elapsed time')).toHaveText(/00:0\d/, { timeout: 10_000 })

  await toolbar.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Resume' })).toBeVisible()
  await toolbar.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByRole('heading', { name: 'Recording', exact: true })).toBeVisible()

  await toolbar.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('heading', { name: 'Recording saved' })).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(1)
  expect(readdirSync(library)).toHaveLength(1)
  await app.close()
})

/**
 * Chromium's video capture service, the helper process behind its fake camera, sometimes crashes on
 * Windows (about 4 in 10 launches here) soon after recording starts. Chromium then reports the camera
 * as unplugged: Leverage correctly keeps recording the screen and marks the camera "Camera
 * disconnected", or the bubble never gets a picture. It happens even when the bubble's own camera
 * request is blocked, so it is not Leverage's doing. The test retries only when Chromium logged that
 * crash; a camera missing for any other reason fails at once.
 */
const CAPTURE_SERVICE_CRASH = 'Detected crash of video capture service'
const ATTEMPTS = 5

test('camera bubble shows during recording and its position is saved', async () => {
  test.setTimeout(ATTEMPTS * 40_000)
  for (let attempt = 1; ; attempt++) {
    const { crashed, cameraSaved, detail } = await recordWithCameraBubble()
    if (cameraSaved || !crashed || attempt === ATTEMPTS) {
      const why = crashed ? `camera lost to a Chromium capture-service crash on all ${ATTEMPTS} attempts` : 'camera not saved'
      expect(cameraSaved, `${why}: ${detail}`).toBe(true)
      return
    }
    const description = `attempt ${attempt}: ${CAPTURE_SERVICE_CRASH}`
    test.info().annotations.push({ type: 'retry', description })
  }
})

async function recordWithCameraBubble(): Promise<{ crashed: boolean; cameraSaved: boolean; detail: string }> {
  // Chromium's fake camera, so this runs on machines without one; its log carries the crash line.
  const { app } = await launchIsolated(undefined, {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--enable-logging=stderr'
    ]
  })
  let stderr = ''
  app.process().stderr?.on('data', (d: Buffer) => void (stderr += d.toString()))
  const crashed = (): boolean => stderr.includes(CAPTURE_SERVICE_CRASH)
  const page = await app.firstWindow()
  const library = await tempLibrary(page)
  await page.getByRole('button', { name: 'Studio' }).click()
  await expect(page.locator('.source').first()).toBeVisible({ timeout: 15_000 })
  // Devices load after the sources; give the camera list a moment before deciding there is none.
  const cameras = await expect
    .poll(() => page.locator('#camera option').count(), { timeout: 5000 })
    .toBeGreaterThan(1)
    .then(() => true, () => false)
  test.skip(!cameras, 'No camera on this machine')

  await page.getByLabel('Camera').selectOption({ index: 1 })
  await page.getByLabel('Microphone').selectOption('')
  await page.getByLabel('System audio').uncheck()
  const bubblePromise = app.waitForEvent('window', (w) => w.url().includes('bubble.html'))
  await page.getByRole('button', { name: '● Record' }).click()
  const bubble = await bubblePromise
  try {
    await expect(bubble.locator('video')).toBeVisible({ timeout: 10_000 })
  } catch (err) {
    // A crash before the bubble opened the camera leaves it showing "Camera unavailable".
    if (!crashed()) throw err
    await app.close()
    return { crashed: true, cameraSaved: false, detail: 'bubble had no camera' }
  }
  await bubble.getByRole('button', { name: 'L', exact: true }).click({ force: true })

  // The encoders can take a couple of seconds to start; record until both tracks hold data (or the
  // camera service crashed), not for a fixed time, or a short recording can keep no track at all.
  const hasData = (file: string): boolean => {
    const [folder] = readdirSync(library)
    const path = folder ? join(library, folder, file) : ''
    return !!path && existsSync(path) && statSync(path).size > 0
  }
  await expect
    .poll(() => crashed() || (hasData('screen.webm') && hasData('camera.webm')), { timeout: 20_000 })
    .toBe(true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Leverage')?.restore())
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('heading', { name: 'Recording saved' })).toBeVisible({ timeout: 30_000 })

  const [folder] = readdirSync(library)
  const manifest = JSON.parse(readFileSync(join(library, folder, 'recording.json'), 'utf8'))
  expect(manifest.bubble.sizeDip).toBe(280)
  const cameraSaved = !!manifest.tracks.camera && existsSync(join(library, folder, 'camera.webm'))
  await app.close()
  const detail = JSON.stringify({ tracks: Object.keys(manifest.tracks), disabled: manifest.disabledTracks })
  return { crashed: crashed(), cameraSaved, detail }
}

test('toolbar shows track warnings while the main window is minimized', async () => {
  const { app } = await launchIsolated()
  const page = await app.firstWindow()
  // Studio reports 'idle' when it mounts; let that happen before simulating a recording status.
  await expect(page.getByRole('heading', { name: 'New recording' })).toBeVisible()
  const toolbarPromise = app.waitForEvent('window', (w) => w.url().includes('toolbar.html'))
  await page.evaluate(() =>
    window.leverage['recorder:status']({
      phase: 'recording',
      elapsedMs: 0,
      warnings: ['Microphone is off: Microphone disconnected']
    })
  )
  const toolbar = await toolbarPromise
  await expect(toolbar.getByRole('alert')).toHaveAttribute('title', /Microphone disconnected/)
  await page.evaluate(() => window.leverage['recorder:status']({ phase: 'idle', elapsedMs: 0 }))
  await app.close()
})

test('the toolbar stays where the user drags it', async () => {
  const { app } = await launchIsolated()
  const page = await app.firstWindow()
  // Studio reports 'idle' when it mounts; let that happen before simulating a recording status.
  await expect(page.getByRole('heading', { name: 'New recording' })).toBeVisible()
  const toolbarPromise = app.waitForEvent('window', (w) => w.url().includes('toolbar.html'))
  await page.evaluate(() => window.leverage['recorder:status']({ phase: 'recording', elapsedMs: 0 }))
  const toolbar = await toolbarPromise
  await toolbar.waitForLoadState('domcontentloaded')
  const moved = await app.evaluate(({ BrowserWindow }) => {
    const tb = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('toolbar.html'))!
    tb.setPosition(40, 40)
    return tb.getPosition()
  })
  // Status updates keep arriving while recording (elapsed time changes).
  for (let ms = 250; ms <= 1000; ms += 250) {
    await page.evaluate((elapsedMs) => window.leverage['recorder:status']({ phase: 'recording', elapsedMs }), ms)
  }
  const after = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('toolbar.html'))!.getPosition()
  )
  expect(after).toEqual(moved)
  await page.evaluate(() => window.leverage['recorder:status']({ phase: 'idle', elapsedMs: 0 }))
  await app.close()
})
