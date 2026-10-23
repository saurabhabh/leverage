import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { launchIsolated } from './launch'

/** Chromium's fake microphone (a steady beep) so dictation has real audio to record. */
const FAKE_MIC = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

async function openListen(
  opts: { env?: Record<string, string>; settings?: Record<string, unknown> } = {}
): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const { app, userData } = await launchIsolated(opts.settings, { args: FAKE_MIC, env: opts.env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start dictation' })).toBeVisible()
  return { app, page, userData }
}

async function pill(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('pill.html'))).toBe(true)
  return app.windows().find((w) => w.url().includes('pill.html'))!
}

/** Start, let the fake mic record for a moment, stop. */
async function dictate(app: ElectronApplication, page: Page, ms = 1500): Promise<Page> {
  await page.getByRole('button', { name: 'Start dictation' }).click()
  const p = await pill(app)
  await expect(p.getByTestId('pill')).toHaveAttribute('data-phase', 'recording')
  await page.waitForTimeout(ms)
  await page.getByRole('button', { name: 'Stop and paste' }).click()
  return p
}

test('the pill never takes focus and stays above other windows', async () => {
  const { app, page } = await openListen()
  await page.getByRole('button', { name: 'Start dictation' }).click()
  await pill(app)
  const info = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Leverage dictation')!
    return { focusable: w.isFocusable(), onTop: w.isAlwaysOnTop(), visible: w.isVisible() }
  })
  expect(info).toEqual({ focusable: false, onTop: true, visible: true })
  await page.getByRole('button', { name: 'Stop and paste' }).click()
  await app.close()
})

test('a failed dictation keeps its audio; the history offers Retry; Delete removes the audio', async () => {
  // Local engine (the default) is not installed in a fresh profile, so transcription fails.
  const { app, page, userData } = await openListen()
  const p = await dictate(app, page)
  await expect(p.getByTestId('pill')).toHaveAttribute('data-phase', 'error')
  await expect(p.getByText(/Install the local speech engine/)).toBeVisible()

  const item = page.getByTestId('dictation')
  await expect(item).toHaveCount(1)
  await expect(item.getByText(/Install the local speech engine/)).toBeVisible()
  await expect(item.getByRole('button', { name: 'Retry' })).toBeVisible()
  const failed = join(userData, 'listen', 'failed')
  expect(readdirSync(failed).filter((f) => f.endsWith('.webm'))).toHaveLength(1)
  expect(readFileSync(join(failed, readdirSync(failed)[0])).length).toBeGreaterThan(1000)

  await item.getByRole('button', { name: 'Delete' }).click()
  await expect(item).toHaveCount(0)
  expect(existsSync(failed) ? readdirSync(failed) : []).toEqual([])
  await app.close()
})

test('cancel from the pill records nothing', async () => {
  const { app, page } = await openListen()
  await page.getByRole('button', { name: 'Start dictation' }).click()
  const p = await pill(app)
  await expect(p.getByTestId('pill')).toHaveAttribute('data-phase', 'recording')
  await p.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('dictate-status')).toHaveText('Ready')
  await page.waitForTimeout(500)
  await expect(page.getByTestId('dictation')).toHaveCount(0)
  await app.close()
})

test('dictionary words and options are saved to settings', async () => {
  const { app, page } = await openListen()
  await page.getByLabel('New dictionary word').fill('Saurabh')
  await page.keyboard.press('Enter')
  await page.getByLabel('New dictionary word').fill('Leverage')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByLabel('Paste into the app I’m typing in').uncheck()
  await expect
    .poll(() => page.evaluate(async () => (await window.leverage['settings:get']()).listen))
    .toMatchObject({ dictionary: ['Saurabh', 'Leverage'], paste: false })
  await page.getByRole('button', { name: 'Remove Saurabh' }).click()
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.leverage['settings:get']()).listen.dictionary)
    )
    .toEqual(['Leverage'])
  await app.close()
})

test('Groq transcription + cleanup (mock server) → text on the clipboard and in history', async () => {
  const { createServer } = await import('http')
  const seen: { path: string; body: string }[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ path: req.url ?? '', body })
      res.setHeader('content-type', 'application/json')
      if (req.url?.endsWith('/audio/transcriptions'))
        res.end(JSON.stringify({ text: 'um send it by friday' }))
      else
        res.end(
          JSON.stringify({ choices: [{ message: { content: '{"text":"Send it by Friday."}' } }] })
        )
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port
  const { app, page } = await openListen({
    env: { LEVERAGE_GROQ_URL: `http://127.0.0.1:${port}/openai/v1` }
  })
  await page.evaluate(async () => {
    await window.leverage['ai:setKey']('groq', 'test-key-not-real')
    const s = await window.leverage['settings:get']()
    await window.leverage['settings:set']({
      ...s,
      ai: { ...s.ai, transcription: 'groq', suggestions: 'groq' },
      listen: { ...s.listen, paste: false, dictionary: ['Friday'] }
    })
  })
  await dictate(app, page)
  await expect(page.getByTestId('dictation').first()).toContainText('Send it by Friday.')
  await expect(page.getByTestId('dictation').first().getByText('Cleaned up')).toBeVisible()
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Send it by Friday.')
  // Only the transcript text goes to the chat model.
  const chatCall = seen.find((s) => s.path.endsWith('/chat/completions'))!
  expect(chatCall.body).toContain('um send it by friday')
  await app.close()
  server.close()
})
