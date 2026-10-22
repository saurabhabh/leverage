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
