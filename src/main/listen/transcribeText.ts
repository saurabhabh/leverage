import { readFile, rm, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { groqBase, providerFetch } from '../ai/chat'
import { GROQ_TRANSCRIBE_MODEL } from '../ai/groq'
import { runWhisper } from '../whisper/local'

/** Dictionary words as Whisper's prompt: names and terms it should spell this way. */
export function dictionaryPrompt(words: string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words.map((x) => x.trim()).filter(Boolean)) {
    if (seen.has(w.toLowerCase())) continue
    if ([...out, w].join(', ').length > 600) break
    seen.add(w.toLowerCase())
    out.push(w)
  }
  return out.join(', ')
}

/**
 * whisper-cli for dictation: plain segments (no word timing) and OpenWhispr's stricter decoder
 * thresholds, which stop near-silent windows turning into "Thank you for watching".
 */
export function whisperTextArgs(
  engine: { cli: string; model: string },
  wav: string,
  outBase: string,
  prompt: string,
  threads: number
): string[] {
  return [
    '-m',
    engine.model,
    '-f',
    wav,
    '-l',
    'auto',
    '-oj',
    '-of',
    outBase,
    '-t',
    String(threads),
    '--entropy-thold',
    '2.8',
    '--logprob-thold',
    '-1.25',
    ...(prompt ? ['--prompt', prompt] : [])
  ]
}

export function textFromWhisperJson(json: unknown): string {
  const segs = ((json ?? {}) as { transcription?: { text?: string }[] }).transcription ?? []
  return segs
    .map((s) => (s.text ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
}

export async function transcribeLocalText(
  engine: { cli: string; model: string },
  wav: string,
  prompt: string,
  threads: number
): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'leverage-dictate-'))
  try {
    await runWhisper(
      engine.cli,
      whisperTextArgs(engine, wav, join(work, 'out'), prompt, threads),
      () => {}
    )
    return textFromWhisperJson(JSON.parse(await readFile(join(work, 'out.json'), 'utf8')))
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** Groq accepts WebM directly, so a dictation is uploaded as recorded (no conversion). */
export async function transcribeGroqText(
  key: string,
  file: string,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
  base = groqBase()
): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([await readFile(file)], { type: 'audio/webm' }), basename(file))
  form.append('model', GROQ_TRANSCRIBE_MODEL)
  form.append('response_format', 'json')
  if (prompt) form.append('prompt', prompt)
  const res = await providerFetch('Groq', fetchImpl, `${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form
  })
  const body = (await res.json()) as { text?: string }
  return (body.text ?? '').trim()
}
