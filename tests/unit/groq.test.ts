import { test, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { transcribeGroq } from '../../src/main/ai/groq'
import { providerError } from '../../src/main/ai/chat'

type Call = { url: string; auth: string | null; form: FormData }

function fakeFetch(responses: (i: number) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: new Headers(init.headers).get('authorization'), form: init.body as FormData })
    return responses(calls.length - 1)
  }) as unknown as typeof fetch
  return { fetch: f, calls }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('transcribeGroq sends model, verbose_json and word granularity, and shifts chunk times', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lev-groq-'))
  const a = join(dir, 'a.mp3')
  const b = join(dir, 'b.mp3')
  writeFileSync(a, 'fake-a')
  writeFileSync(b, 'fake-b')
  const { fetch, calls } = fakeFetch((i) =>
    json({ language: 'English', words: [{ word: i === 0 ? 'hello' : 'there', start: 0.5, end: 0.9 }] })
  )
  const result = await transcribeGroq('k-test', [{ file: a, startMs: 0 }, { file: b, startMs: 600_000 }], fetch, 'http://groq.test/openai/v1')
  expect(calls).toHaveLength(2)
  expect(calls[0].url).toBe('http://groq.test/openai/v1/audio/transcriptions')
  expect(calls[0].auth).toBe('Bearer k-test')
  expect(calls[0].form.get('model')).toBe('whisper-large-v3-turbo')
  expect(calls[0].form.get('response_format')).toBe('verbose_json')
  expect(calls[0].form.getAll('timestamp_granularities[]')).toEqual(['word'])
  expect(result.words).toEqual([
    { text: 'hello', startMs: 500, endMs: 900 },
    { text: 'there', startMs: 600_500, endMs: 600_900 }
  ])
  expect(result.language).toBe('English')
})

test('a Groq error stops with the mapped message', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lev-groq-'))
  const a = join(dir, 'a.mp3')
  writeFileSync(a, 'x')
  const { fetch } = fakeFetch(() => json({ error: { message: 'Invalid API Key' } }, 401))
  await expect(transcribeGroq('bad', [{ file: a, startMs: 0 }], fetch, 'http://groq.test/openai/v1')).rejects.toThrow(
    'Groq rejected the API key — check it in Settings'
  )
})

test('providerError maps 401, 429, 503 and network errors', () => {
  expect(providerError('Groq', 401, '').message).toBe('Groq rejected the API key — check it in Settings')
  expect(providerError('OpenRouter', 403, '').message).toBe('OpenRouter rejected the API key — check it in Settings')
  expect(providerError('Groq', 429, '').message).toBe('Groq rate limit reached — wait a minute and try again')
  expect(providerError('OpenRouter', 503, '').message).toBe('OpenRouter is having problems (HTTP 503)')
  expect(providerError('Groq', 0, '').message).toBe('Could not reach Groq — check your internet connection')
  expect(providerError('Groq', 400, '{"error":{"message":"file too large"}}').message).toBe('Groq: file too large')
})
