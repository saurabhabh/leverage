import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { launchIsolated } from './launch'

// A made-up value: tests never use real API keys.
const DUMMY = 'test-key-not-real'

test('saving a Groq key shows Saved and never returns the key', async () => {
  const { app, page, userData } = await launchIsolated().then(async (r) => ({ ...r, page: await r.app.firstWindow() }))
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Transcription & AI' })).toBeVisible()

  const input = page.getByLabel('Groq API key')
  await input.fill(DUMMY)
  await page.getByRole('button', { name: 'Save Groq key' }).click()
  await expect(page.getByText('Groq key saved ✓')).toBeVisible()
  await expect(input).toHaveValue('')

  expect(await page.evaluate(() => window.leverage['ai:hasKeys']())).toEqual({ groq: true, openrouter: false })
  expect(readFileSync(join(userData, 'keys.json'), 'utf8')).not.toContain(DUMMY)
  // No channel can read a key back.
  expect(await page.evaluate(() => Object.keys(window.leverage).filter((k) => /getkey/i.test(k)))).toEqual([])
  await app.close()
})

test('engine and provider choices are saved to settings', async () => {
  const { app, userData } = await launchIsolated()
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Groq (cloud)').check()
  await page.getByLabel('Suggestions provider').selectOption('openrouter')
  await page.getByLabel('OpenRouter model').fill('anthropic/claude-haiku-5.5')
  await page.getByLabel('OpenRouter model').blur()
  await expect
    .poll(() => {
      try {
        return JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).ai
      } catch {
        return null
      }
    })
    .toMatchObject({ transcription: 'groq', suggestions: 'openrouter', openrouterModel: 'anthropic/claude-haiku-5.5' })
  await app.close()
})
