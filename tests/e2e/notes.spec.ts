import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchIsolated } from './launch'
import { seedCrashedRecording } from './fixtures'
import { haveEngine, preinstallWhisper, SPEECH_MIC } from './whisperLab'

const FAKE_MIC = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
const WORDS = 'We agreed to ship on Friday. Asha will send the deck.'
  .split(' ')
  .map((text, i) => ({ text, startMs: i * 300, endMs: i * 300 + 250 }))

async function launch(
  opts: { env?: Record<string, string>; args?: string[]; prepare?: (userData: string) => void } = {}
): Promise<{ app: ElectronApplication; page: Page; notesDir: string }> {
  const base = mkdtempSync(join(tmpdir(), 'lev-notes-e2e-'))
  const library = join(base, 'Library')
  seedCrashedRecording(library, { transcript: WORDS })
  const notesDir = join(base, 'Notes')
  const { app } = await launchIsolated(
    {
      libraryDir: library,
      listen: {
        hotkey: 'CommandOrControl+Shift+Space',
        paste: true,
        cleanup: true,
        dictionary: [],
        notesDir
      }
    },
    { args: opts.args ?? FAKE_MIC, env: opts.env, prepare: opts.prepare }
  )
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, notesDir }
}

const noteJson = (notesDir: string): Record<string, unknown> => {
  const [dir] = readdirSync(notesDir)
  return JSON.parse(readFileSync(join(notesDir, dir, 'note.json'), 'utf8'))
}

test('Library → Make notes reuses the recording’s transcript and explains the missing summary', async () => {
  const { app, page } = await launch()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByTestId('library-item').getByRole('button', { name: 'Make notes' }).click()
  const note = page.getByTestId('note')
  await expect(note).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Listen' })).toBeVisible()
  await expect(note.getByText(/Add a Groq API key in Settings for an AI summary/)).toBeVisible()
  await note.getByText('Transcript').click()
  await expect(
    note.getByText('We agreed to ship on Friday. Asha will send the deck.')
  ).toBeVisible()
  await app.close()
})

test('a meeting records the mic into the note folder; system audio missing is explained; notes and title are saved', async () => {
  const { app, page, notesDir } = await launch()
  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  await page.getByRole('tab', { name: 'Notes' }).click()
  await page.getByLabel('Meeting title').fill('Weekly sync')
  await page.getByRole('button', { name: 'Start recording' }).click()
  const note = page.getByTestId('note')
  await expect(note.getByRole('button', { name: 'Stop and make notes' })).toBeVisible()
  await note.getByLabel('My notes').fill('Ask about the budget')
  // Keeps recording while another page is open.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  await note.getByRole('button', { name: 'Stop and make notes' }).click()

  // Local Whisper isn't installed in a fresh profile: the note fails clearly and can be retried.
  await expect(note.getByText(/Failed: Install the local speech engine/)).toBeVisible({
    timeout: 15_000
  })
  await expect(note.getByRole('button', { name: 'Try again' })).toBeVisible()
  const doc = noteJson(notesDir) as {
    title: string
    notes: string
    tracks: { mic?: string; system?: string }
    warnings: string[]
    durationMs: number
  }
  expect(doc).toMatchObject({
    title: 'Weekly sync',
    notes: 'Ask about the budget',
    tracks: { mic: 'mic.webm' }
  })
  expect(doc.durationMs).toBeGreaterThan(2000)
  const [dir] = readdirSync(notesDir)
  expect(statSync(join(notesDir, dir, 'mic.webm')).size).toBeGreaterThan(5000)
  if (!doc.tracks.system) expect(doc.warnings.join(' ')).toMatch(/System audio isn’t available/)

  await note.getByLabel('Title').fill('Weekly sync (Oct)')
  await note.getByLabel('Title').press('Enter')
  await expect.poll(() => (noteJson(notesDir) as { title: string }).title).toBe('Weekly sync (Oct)')
  await note.getByRole('button', { name: '← Notes' }).click()
  await expect(page.getByTestId('note-item')).toContainText('Weekly sync (Oct)')
  await app.close()
})

test('AI summary from a mock Groq: sections render, Regenerate works, only text is sent', async () => {
  const { createServer } = await import('http')
  const bodies: string[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      bodies.push(body)
      res.setHeader('content-type', 'application/json')
      const md = '## Summary\nShip Friday.\n## Action items\n- [ ] Send the deck — Asha'
      res.end(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: md }) } }] })
      )
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port
  const { app, page } = await launch({
    env: { LEVERAGE_GROQ_URL: `http://127.0.0.1:${port}/openai/v1` }
  })
  await page.evaluate(() => window.leverage['ai:setKey']('groq', 'test-key-not-real'))
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByTestId('library-item').getByRole('button', { name: 'Make notes' }).click()
  const note = page.getByTestId('note')
  await expect(note.getByRole('heading', { name: 'Action items' })).toBeVisible()
  await expect(note.getByText('Send the deck — Asha')).toBeVisible()
  await note.getByRole('button', { name: 'Regenerate' }).click()
  await expect.poll(() => bodies.length).toBe(2)
  expect(bodies[0]).toContain('We agreed to ship on Friday.')
  await app.close()
  server.close()
})

test('local Whisper: a recorded meeting is transcribed into its note', async () => {
  test.skip(!haveEngine, 'whisper.cpp not present in _lab')
  test.setTimeout(180_000)
  const { app, page } = await launch({ args: SPEECH_MIC, prepare: preinstallWhisper })
  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  await page.getByRole('tab', { name: 'Notes' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  const note = page.getByTestId('note')
  await expect(note.getByRole('button', { name: 'Stop and make notes' })).toBeVisible()
  await page.waitForTimeout(6000)
  await note.getByRole('button', { name: 'Stop and make notes' }).click()
  // No AI key: the transcript arrives and the note explains the missing summary.
  await expect(note.getByText(/Add a Groq API key in Settings for an AI summary/)).toBeVisible({
    timeout: 150_000
  })
  await note.getByText('Transcript').click()
  await expect(note.locator('.note-transcript')).toContainText(/welcome/i)
  await app.close()
})
