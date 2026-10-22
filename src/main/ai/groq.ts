import { readFile } from 'fs/promises'
import { basename } from 'path'
import type { Word } from '../../shared/transcript'
import { groqBase, providerFetch } from './chat'

export const GROQ_TRANSCRIBE_MODEL = 'whisper-large-v3-turbo'

type GroqWord = { word: string; start: number; end: number }

/**
 * Transcribe MP3 chunks (each ≤ 10 min, under Groq's upload limit) with word timestamps. Each
 * chunk's word times are shifted by where the chunk starts.
 */
export async function transcribeGroq(
  key: string,
  chunks: { file: string; startMs: number }[],
  fetchImpl: typeof fetch = fetch,
  base = groqBase(),
  signal?: AbortSignal
): Promise<{ language: string; words: Word[] }> {
  const words: Word[] = []
  let language = 'unknown'
  for (const chunk of chunks) {
    const form = new FormData()
    form.append('file', new Blob([await readFile(chunk.file)], { type: 'audio/mpeg' }), basename(chunk.file))
    form.append('model', GROQ_TRANSCRIBE_MODEL)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'word')
    const res = await providerFetch('Groq', fetchImpl, `${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal
    })
    const body = (await res.json()) as { language?: string; words?: GroqWord[] }
    if (body.language) language = body.language
    for (const w of body.words ?? []) {
      const text = w.word.trim()
      if (!text) continue
      words.push({
        text,
        startMs: Math.round(chunk.startMs + w.start * 1000),
        endMs: Math.round(chunk.startMs + Math.max(w.start, w.end) * 1000)
      })
    }
  }
  return { language, words }
}
