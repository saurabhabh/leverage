export type ProviderName = 'Groq' | 'OpenRouter'

/** A readable error for a failed provider call. status 0 means the request never got a response. */
export function providerError(provider: ProviderName, status: number, body: string): Error {
  if (status === 0) return new Error(`Could not reach ${provider} — check your internet connection`)
  if (status === 401 || status === 403) return new Error(`${provider} rejected the API key — check it in Settings`)
  if (status === 429) return new Error(`${provider} rate limit reached — wait a minute and try again`)
  if (status >= 500) return new Error(`${provider} is having problems (HTTP ${status})`)
  let detail = ''
  try {
    const parsed = JSON.parse(body)
    detail = parsed?.error?.message ?? parsed?.message ?? ''
  } catch {
    detail = body.slice(0, 200)
  }
  return new Error(detail ? `${provider}: ${detail}` : `${provider} request failed (HTTP ${status})`)
}

/** fetch that turns network failures and non-2xx responses into providerError. */
export async function providerFetch(
  provider: ProviderName,
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit
): Promise<Response> {
  let res: Response
  try {
    res = await fetchImpl(url, init)
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err
    throw providerError(provider, 0, '')
  }
  if (!res.ok) throw providerError(provider, res.status, await res.text().catch(() => ''))
  return res
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

/** Overridable for tests only. */
export const groqBase = (): string => process.env['LEVERAGE_GROQ_URL'] ?? 'https://api.groq.com/openai/v1'
export const openrouterBase = (): string => process.env['LEVERAGE_OPENROUTER_URL'] ?? 'https://openrouter.ai/api/v1'

/**
 * One OpenAI-compatible chat completion asking for a JSON object. Groq and OpenRouter share the API;
 * only the base URL and OpenRouter's attribution headers differ.
 */
export async function chat(
  provider: 'groq' | 'openrouter',
  key: string,
  model: string,
  messages: ChatMessage[],
  fetchImpl: typeof fetch = fetch,
  base?: string,
  signal?: AbortSignal
): Promise<string> {
  const name: ProviderName = provider === 'groq' ? 'Groq' : 'OpenRouter'
  const url = `${base ?? (provider === 'groq' ? groqBase() : openrouterBase())}/chat/completions`
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://leverage.local'
    headers['X-Title'] = 'Leverage'
  }
  const res = await providerFetch(name, fetchImpl, url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, temperature: 0.2, response_format: { type: 'json_object' } }),
    signal
  })
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = body.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error(`${name} sent an empty reply — try again`)
  return content
}
