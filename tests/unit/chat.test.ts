import { test, expect } from 'vitest'
import { chat } from '../../src/main/ai/chat'

type Call = { url: string; headers: Headers; body: Record<string, unknown> }

function fake(status = 200, content = '{"cuts":[]}'): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) })
    return new Response(
      status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : JSON.stringify({ error: { message: 'nope' } }),
      { status }
    )
  }) as unknown as typeof fetch
  return { fetch: f, calls }
}

const messages = [
  { role: 'system' as const, content: 'sys' },
  { role: 'user' as const, content: 'hi' }
]

test('chat sends model, json mode, low temperature and auth to Groq', async () => {
  const { fetch, calls } = fake()
  const reply = await chat('groq', 'k1', 'openai/gpt-oss-120b', messages, { fetchImpl: fetch, base: 'http://groq.test/v1' })
  expect(reply).toBe('{"cuts":[]}')
  expect(calls[0].url).toBe('http://groq.test/v1/chat/completions')
  expect(calls[0].headers.get('authorization')).toBe('Bearer k1')
  expect(calls[0].body).toMatchObject({
    model: 'openai/gpt-oss-120b',
    messages,
    temperature: 0.2,
    response_format: { type: 'json_object' }
  })
})

test('OpenRouter calls carry the app attribution headers', async () => {
  const { fetch, calls } = fake()
  await chat('openrouter', 'k2', 'anthropic/claude-sonnet-5.5', messages, { fetchImpl: fetch, base: 'http://or.test/api/v1' })
  expect(calls[0].url).toBe('http://or.test/api/v1/chat/completions')
  expect(calls[0].headers.get('x-title')).toBe('Leverage')
  expect(calls[0].headers.get('http-referer')).toBe('https://leverage.local')
})

test('401 and 429 map to readable provider errors', async () => {
  await expect(chat('groq', 'bad', 'm', messages, { fetchImpl: fake(401).fetch, base: 'http://g' })).rejects.toThrow(
    'Groq rejected the API key — check it in Settings'
  )
  await expect(chat('openrouter', 'k', 'm', messages, { fetchImpl: fake(429).fetch, base: 'http://o' })).rejects.toThrow(
    'OpenRouter rate limit reached — wait a minute and try again'
  )
})

test('a reasoning effort is sent only to gpt-oss models on Groq', async () => {
  const groq = fake()
  await chat('groq', 'k', 'openai/gpt-oss-120b', messages, { fetchImpl: groq.fetch, base: 'http://g', reasoningEffort: 'high' })
  expect(groq.calls[0].body.reasoning_effort).toBe('high')

  const otherModel = fake()
  await chat('groq', 'k', 'qwen/qwen3.8-27b', messages, { fetchImpl: otherModel.fetch, base: 'http://g', reasoningEffort: 'high' })
  expect(otherModel.calls[0].body).not.toHaveProperty('reasoning_effort')

  const openrouter = fake()
  await chat('openrouter', 'k', 'openai/gpt-oss-120b', messages, {
    fetchImpl: openrouter.fetch,
    base: 'http://o',
    reasoningEffort: 'high'
  })
  expect(openrouter.calls[0].body).not.toHaveProperty('reasoning_effort')

  const unset = fake()
  await chat('groq', 'k', 'openai/gpt-oss-120b', messages, { fetchImpl: unset.fetch, base: 'http://g' })
  expect(unset.calls[0].body).not.toHaveProperty('reasoning_effort')
})

test('json: false asks for plain text (no JSON mode)', async () => {
  const { fetch, calls } = fake(200, '## Summary')
  const reply = await chat('groq', 'k', 'm', messages, { fetchImpl: fetch, base: 'http://g', json: false })
  expect(reply).toBe('## Summary')
  expect(calls[0].body).not.toHaveProperty('response_format')
})

test('an empty reply is an error', async () => {
  await expect(chat('groq', 'k', 'm', messages, { fetchImpl: fake(200, '').fetch, base: 'http://g' })).rejects.toThrow(/empty reply/i)
})
