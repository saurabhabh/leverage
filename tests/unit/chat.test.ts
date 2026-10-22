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
  const reply = await chat('groq', 'k1', 'openai/gpt-oss-120b', messages, fetch, 'http://groq.test/v1')
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
  await chat('openrouter', 'k2', 'anthropic/claude-sonnet-5.5', messages, fetch, 'http://or.test/api/v1')
  expect(calls[0].url).toBe('http://or.test/api/v1/chat/completions')
  expect(calls[0].headers.get('x-title')).toBe('Leverage')
  expect(calls[0].headers.get('http-referer')).toBe('https://leverage.local')
})

test('401 and 429 map to readable provider errors', async () => {
  await expect(chat('groq', 'bad', 'm', messages, fake(401).fetch, 'http://g')).rejects.toThrow(
    'Groq rejected the API key — check it in Settings'
  )
  await expect(chat('openrouter', 'k', 'm', messages, fake(429).fetch, 'http://o')).rejects.toThrow(
    'OpenRouter rate limit reached — wait a minute and try again'
  )
})

test('an empty reply is an error', async () => {
  await expect(chat('groq', 'k', 'm', messages, fake(200, '').fetch, 'http://g')).rejects.toThrow(/empty reply/i)
})
