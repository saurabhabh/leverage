import type { Word } from '../../shared/transcript'

export type Suggestion = { from: number; to: number; reason: string }

/**
 * The AI sees only the transcript, as `index:word` tokens, and answers with word-index ranges.
 * Nothing but the text leaves the PC.
 */
export function buildSuggestPrompt(words: Word[], opts: { targetSeconds?: number }): { system: string; user: string } {
  const target = opts.targetSeconds
    ? ` The speaker would like the video to end up about ${Math.round(opts.targetSeconds)} seconds long; suggest enough cuts to get close, least valuable first.`
    : ''
  const system =
    'You are a careful video editor working from a transcript of a screen-recorded tutorial. ' +
    'Find parts that should be cut: retakes (the speaker restarts a sentence — keep the last, best take), ' +
    'false starts, long rambles and off-topic asides. ' +
    'Never cut content the speaker clearly meant to keep, and never cut the middle of a sentence that stays.' +
    target +
    ' The transcript may mix English with Hindi or Marathi. ' +
    'Words are given as index:word. Reply with ONLY a JSON object, no prose: ' +
    '{"cuts":[{"from":<first word index>,"to":<last word index, inclusive>,"reason":"<short reason>"}]}. ' +
    'If nothing should be cut, reply {"cuts":[]}.'
  const user = words.map((w, i) => `${i}:${w.text}`).join(' ')
  return { system, user }
}

/** Strip code fences and take the outermost {...}. */
function extractJson(raw: string): unknown {
  const text = raw.replace(/```(?:json)?/gi, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON')
  return JSON.parse(text.slice(start, end + 1))
}

/**
 * Validate the AI's cuts: integer indexes inside the transcript, from ≤ to, no overlaps.
 * Bad items are dropped and counted — never guessed at.
 */
export function parseSuggestions(
  raw: string,
  wordCount: number
): { cuts: Suggestion[]; dropped: number; error?: string } {
  let parsed: unknown
  try {
    parsed = extractJson(raw)
  } catch {
    return { cuts: [], dropped: 0, error: 'The AI reply could not be read. Try again.' }
  }
  const items = Array.isArray((parsed as { cuts?: unknown })?.cuts) ? ((parsed as { cuts: unknown[] }).cuts) : []
  const valid: Suggestion[] = []
  let dropped = 0
  for (const item of items) {
    const { from, to, reason } = (item ?? {}) as Record<string, unknown>
    if (!Number.isInteger(from) || !Number.isInteger(to) || (from as number) < 0 || (to as number) >= wordCount || (from as number) > (to as number)) {
      dropped++
      continue
    }
    valid.push({ from: from as number, to: to as number, reason: typeof reason === 'string' ? reason : '' })
  }
  // Keep the earlier of any overlapping pair, in the order the AI gave them.
  const kept: Suggestion[] = []
  for (const s of valid) {
    if (kept.some((k) => s.from <= k.to && k.from <= s.to)) dropped++
    else kept.push(s)
  }
  return { cuts: kept.sort((a, b) => a.from - b.from), dropped }
}
