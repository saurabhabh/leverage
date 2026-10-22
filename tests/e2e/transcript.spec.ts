import { test, expect, type Page } from '@playwright/test'
import { cpSync, existsSync, mkdirSync } from 'fs'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { join, resolve } from 'path'
import { openEditor } from './editorHelpers'

const WORDS = [
  { text: 'Hello', startMs: 100, endMs: 400 },
  { text: 'um,', startMs: 400, endMs: 700 },
  { text: 'this', startMs: 700, endMs: 1000 },
  { text: 'is', startMs: 1000, endMs: 1300 },
  { text: 'a', startMs: 1300, endMs: 1500 },
  { text: 'test.', startMs: 1500, endMs: 2000 },
  { text: 'You', startMs: 2000, endMs: 2200 },
  { text: 'know,', startMs: 2200, endMs: 2400 },
  { text: 'thanks.', startMs: 2500, endMs: 3000 }
]

const word = (page: Page, text: string) => page.getByTestId('word').filter({ hasText: new RegExp(`^${text}$`) })
const time = (page: Page) => page.getByTestId('time')

test('a seeded transcript shows its words; clicking one seeks there', async () => {
  const { app, page } = await openEditor({ transcript: WORDS })
  await page.getByRole('tab', { name: 'Transcript' }).click()
  await expect(page.getByTestId('word')).toHaveCount(WORDS.length)
  await word(page, 'test.').click()
  await expect(time(page)).toHaveText(/^00:01\.5 \//)
  await expect(word(page, 'test.')).toHaveClass(/current/)
  await word(page, 'Hello').click()
  await expect(word(page, 'Hello')).toHaveClass(/current/)
  await expect(word(page, 'test.')).not.toHaveClass(/current/)
  // "You know" is flagged, not cut.
  await expect(word(page, 'You')).toHaveAttribute('data-flagged', 'true')
  await app.close()
})

test('selecting words and pressing Delete cuts them; Ctrl+Z restores', async () => {
  const { app, page } = await openEditor({ transcript: WORDS })
  await page.getByRole('tab', { name: 'Transcript' }).click()
  await expect(time(page)).toHaveText(/\/ 00:03\.1$/)
  await word(page, 'this').click()
  await word(page, 'test.').click({ modifiers: ['Shift'] })
  await page.keyboard.press('Delete')
  for (const w of ['this', 'is', 'a', 'test.']) await expect(word(page, w)).toHaveAttribute('data-state', 'cut')
  await expect(word(page, 'Hello')).toHaveAttribute('data-state', 'kept')
  await expect(time(page)).toHaveText(/\/ 00:01\.8$/)
  await page.keyboard.press('Control+z')
  await expect(word(page, 'this')).toHaveAttribute('data-state', 'kept')
  await app.close()
})

test('a recording without mic or system audio explains why Transcribe is unavailable', async () => {
  const { app, page } = await openEditor({ audio: false })
  await page.getByRole('tab', { name: 'Transcript' }).click()
  await expect(page.getByRole('button', { name: /Transcribe/ })).toBeDisabled()
  await expect(page.getByText(/no microphone or system audio/i)).toBeVisible()
  await app.close()
})

test('with the local engine missing, Transcribe offers the one-time download with sizes', async () => {
  const { app, page } = await openEditor()
  await page.getByRole('tab', { name: 'Transcript' }).click()
  await page.getByRole('button', { name: /Transcribe/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('22 MB')
  await expect(dialog).toContainText('148 MB')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await app.close()
})

const LAB = resolve(__dirname, '..', '..', '_lab', 'whisper-dl')
const haveEngine = existsSync(join(LAB, 'bin', 'Release', 'whisper-cli.exe')) && existsSync(join(LAB, 'models', 'ggml-base.bin'))

test('local transcription of real speech fills the transcript', async () => {
  test.skip(!haveEngine, 'whisper.cpp not present in _lab')
  test.setTimeout(180_000)
  const { app, page } = await openEditor(
    { micSpeech: true },
    {
      // Pre-install the verified engine and model into the isolated profile.
      prepare: (userData) => {
        mkdirSync(join(userData, 'whisper', 'models'), { recursive: true })
        cpSync(join(LAB, 'bin', 'Release'), join(userData, 'whisper', 'bin'), { recursive: true })
        cpSync(join(LAB, 'models', 'ggml-base.bin'), join(userData, 'whisper', 'models', 'ggml-base.bin'))
      }
    }
  )
  await page.getByRole('tab', { name: 'Transcript' }).click()
  await page.getByRole('button', { name: /Transcribe/ }).click()
  await expect(page.getByTestId('word').filter({ hasText: /^welcome/i })).toBeVisible({ timeout: 150_000 })
  await app.close()
})

test('Groq transcription (mock server) fills the transcript; a bad key shows the key message', async () => {
  let status = 200
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(
        status === 200
          ? JSON.stringify({ language: 'English', words: [{ word: 'Namaste', start: 0.2, end: 0.6 }, { word: 'everyone', start: 0.6, end: 1.1 }] })
          : JSON.stringify({ error: { message: 'Invalid API Key' } })
      )
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/openai/v1`
  try {
    const { app, page } = await openEditor(
      {},
      {
        settings: { ai: { transcription: 'groq', suggestions: 'groq', groqChatModel: 'm', openrouterModel: 'm' } },
        env: { LEVERAGE_GROQ_URL: url }
      }
    )
    await page.evaluate(() => window.leverage['ai:setKey']('groq', 'test-key-not-real'))
    await page.getByRole('tab', { name: 'Transcript' }).click()
    status = 401
    await page.getByRole('button', { name: /Transcribe/ }).click()
    await expect(page.getByRole('alert')).toContainText('Groq rejected the API key')
    status = 200
    await page.getByRole('button', { name: /Transcribe/ }).click()
    await expect(page.getByTestId('word').filter({ hasText: 'Namaste' })).toBeVisible()
    await app.close()
  } finally {
    server.close()
  }
})

test('playback stays smooth with an hour-long transcript and many clips', async () => {
  // 9,000 words (about an hour of speech) and an edit of 100 clips, as after Remove pauses.
  const long = Array.from({ length: 9000 }, (_, i) => ({ text: 'w' + i, startMs: Math.floor(i * 1.2), endMs: Math.floor(i * 1.2) + 1 }))
  const clips = Array.from({ length: 100 }, (_, i) => ({ id: 'c' + i, srcStartMs: i * 110, srcEndMs: i * 110 + 100 }))
  const { app, page, dir } = await openEditor({ transcript: long, micSpeech: true })
  await page.evaluate(
    async ({ clips }) => {
      const opened = await window.leverage['edit:open']('crashed-1')
      await window.leverage['edit:save']('crashed-1', { ...opened.edit, clips })
    },
    { clips }
  )
  // Reopen so the editor loads the 300-clip edit.
  await page.getByRole('button', { name: '← Library' }).click()
  await page.getByTestId('library-item').getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByTestId('word')).toHaveCount(9000, { timeout: 20_000 })
  const fps = (): Promise<number> =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0
          const t0 = performance.now()
          const tick = (): void => {
            frames++
            if (performance.now() - t0 < 1000) requestAnimationFrame(tick)
            else resolve(frames)
          }
          requestAnimationFrame(tick)
        })
    )
  // Compare against this machine's own idle frame rate, so the test works at any refresh rate.
  const idle = await fps()
  await page.getByRole('button', { name: 'Play' }).click()
  const playing = await fps()
  console.log('FPS idle', idle, 'playing', playing, dir)
  expect(playing / idle).toBeGreaterThan(0.9)
  await app.close()
})
