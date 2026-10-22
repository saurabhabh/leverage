import { test, expect, type Page } from '@playwright/test'
import { openEditor } from './editorHelpers'

const time = (page: Page) => page.getByTestId('time')

test('Remove pauses cuts the 1.5 s pause (about 1.0 s after padding) and one Ctrl+Z restores it', async () => {
  const { app, page } = await openEditor({ micPause: true })
  await expect(time(page)).toHaveText(/\/ 00:03\.1$/)
  await page.getByRole('button', { name: 'Remove pauses' }).click()
  await expect(page.getByRole('status').filter({ hasText: /Removed 1 pause/ })).toBeVisible()
  // Opus smears the silence edges a little: about 1.0 s comes out.
  await expect(time(page)).toHaveText(/\/ 00:02\.[0-2]$/)
  await page.keyboard.press('Control+z')
  await expect(time(page)).toHaveText(/\/ 00:03\.1$/)
  await app.close()
})

test('Remove pauses reports when there are none', async () => {
  const { app, page } = await openEditor()
  await page.getByRole('button', { name: 'Remove pauses' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'No long pauses found' })).toBeVisible()
  await expect(time(page)).toHaveText(/\/ 00:03\.1$/)
  await app.close()
})

test('Remove filler words cuts "um" from a transcript', async () => {
  const { app, page } = await openEditor({
    transcript: [
      { text: 'Hello', startMs: 100, endMs: 400 },
      { text: 'um,', startMs: 400, endMs: 700 },
      { text: 'world.', startMs: 700, endMs: 1200 }
    ]
  })
  await page.getByRole('button', { name: 'Remove filler words' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Removed 1 filler word' })).toBeVisible()
  await expect(page.getByTestId('word').filter({ hasText: /^um,$/ })).toHaveAttribute('data-state', 'cut')
  await expect(time(page)).toHaveText(/\/ 00:02\.8$/)
  await app.close()
})

test('Remove filler words needs a transcript first', async () => {
  const { app, page } = await openEditor()
  await expect(page.getByRole('button', { name: 'Remove filler words' })).toBeDisabled()
  await app.close()
})

test('AI suggestions from a mock Groq appear with reasons; Apply cuts those words; a 401 shows the key message', async () => {
  const { createServer } = await import('http')
  let status = 401
  let lastBody = ''
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      lastBody = body
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      const content = JSON.stringify({
        cuts: [
          { from: 2, to: 5, reason: 'Retake: the sentence is said again' },
          { from: 7, to: 99, reason: 'out of range' }
        ]
      })
      res.end(status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : JSON.stringify({ error: { message: 'bad key' } }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as import('net').AddressInfo).port
  try {
    const { app, page } = await openEditor(
      {
        transcript: [
          { text: 'So', startMs: 100, endMs: 300 },
          { text: 'today', startMs: 300, endMs: 600 },
          { text: 'we', startMs: 600, endMs: 800 },
          { text: 'will', startMs: 800, endMs: 1000 },
          { text: 'um', startMs: 1000, endMs: 1200 },
          { text: 'so', startMs: 1200, endMs: 1400 },
          { text: 'today', startMs: 1400, endMs: 1700 },
          { text: 'we', startMs: 1700, endMs: 1900 },
          { text: 'start.', startMs: 1900, endMs: 2400 }
        ]
      },
      { env: { LEVERAGE_GROQ_URL: `http://127.0.0.1:${port}/openai/v1` } }
    )
    await page.evaluate(() => window.leverage['ai:setKey']('groq', 'test-key-not-real'))
    await page.getByRole('button', { name: 'Suggest cuts with AI' }).click()
    await expect(page.getByRole('alert')).toContainText('Groq rejected the API key')

    status = 200
    await page.getByRole('button', { name: 'Suggest cuts with AI' }).click()
    const item = page.getByTestId('suggestion')
    await expect(item).toHaveCount(1)
    await expect(item).toContainText('Retake: the sentence is said again')
    await expect(item).toContainText('we will um so')
    await expect(page.getByText("1 suggestion couldn't be used")).toBeVisible()
    // The transcript itself must stay on screen alongside the suggestions.
    await expect(page.getByTestId('word').first()).toBeVisible()
    expect((await page.locator('.transcript-words').boundingBox())!.height).toBeGreaterThan(40)
    // Only the transcript text was sent.
    expect(lastBody).toContain('0:So 1:today 2:we')
    expect(lastBody).not.toMatch(/webm|base64/i)

    await item.getByRole('button', { name: 'Apply' }).click()
    for (const w of ['we', 'will', 'um', 'so']) {
      await expect(page.getByTestId('word').filter({ hasText: new RegExp(`^${w}$`) }).first()).toHaveAttribute('data-state', 'cut')
    }
    await expect(page.getByTestId('suggestion')).toHaveCount(0)
    await app.close()
  } finally {
    server.close()
  }
})
