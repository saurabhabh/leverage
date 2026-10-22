import { z } from 'zod'
import { sourceToOutput, type EditDoc } from './edit'

/** Times are on the SOURCE timeline (same as edit clips), so a transcript never changes with edits. */
export const WordSchema = z.object({ text: z.string(), startMs: z.number(), endMs: z.number() })
export const TranscriptSchema = z.object({
  version: z.literal(1),
  engine: z.enum(['local', 'groq']),
  language: z.string(),
  track: z.enum(['mic', 'system']),
  words: z.array(WordSchema),
  createdAt: z.string()
})

export type Word = z.infer<typeof WordSchema>
export type Transcript = z.infer<typeof TranscriptSchema>
export type Range = { startMs: number; endMs: number }

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'hmm', 'mm', 'hm'])
/** Flagged only — often meaningful, so never removed automatically. */
const PHRASES = [
  ['you', 'know'],
  ['i', 'mean']
]

export const bare = (word: string): string => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

export const isFiller = (word: string): boolean => FILLERS.has(bare(word))

/** Source ranges covered by filler words; neighbouring fillers merge into one range. */
export function fillerRanges(words: Word[]): Range[] {
  const out: Range[] = []
  words.forEach((w, i) => {
    if (!isFiller(w.text)) return
    const prev = out[out.length - 1]
    if (prev && i > 0 && isFiller(words[i - 1].text)) prev.endMs = w.endMs
    else out.push({ startMs: w.startMs, endMs: w.endMs })
  })
  return out
}

/** Index of the first word of each flagged phrase. */
export function flaggedPhrases(words: Word[]): number[] {
  const out: number[] = []
  for (let i = 0; i < words.length; i++) {
    if (PHRASES.some((p) => p.every((part, j) => bare(words[i + j]?.text ?? '') === part))) out.push(i)
  }
  return out
}

/**
 * Silences from ffmpeg silencedetect stderr, shrunk by `padMs` on each side so speech is not clipped.
 * A silence still open when the file ends runs to `endMs` (if given).
 */
export function parseSilences(stderr: string, padMs = 250, endMs?: number): Range[] {
  const out: Range[] = []
  let open: number | null = null
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start: (-?[\d.]+)/.exec(line)
    const e = /silence_end: ([\d.]+)/.exec(line)
    if (s) open = Math.max(0, Number(s[1]) * 1000)
    else if (e && open !== null) {
      out.push({ startMs: open, endMs: Number(e[1]) * 1000 })
      open = null
    }
  }
  if (open !== null && endMs !== undefined) out.push({ startMs: open, endMs })
  return out
    .map((r) => ({ startMs: Math.round(r.startMs + padMs), endMs: Math.round(r.endMs - padMs) }))
    .filter((r) => r.endMs > r.startMs)
}

/** Whether a word still plays in the edit: fully, not at all, or only in part. */
export function wordState(e: EditDoc, w: Word): 'kept' | 'cut' | 'partial' {
  const length = w.endMs - w.startMs
  if (length <= 0) {
    return sourceToOutput(e, w.startMs, w.startMs + 1).length ? 'kept' : 'cut'
  }
  const covered = sourceToOutput(e, w.startMs, w.endMs).reduce((sum, iv) => sum + iv.outEndMs - iv.outStartMs, 0)
  if (covered <= 0) return 'cut'
  return covered >= length ? 'kept' : 'partial'
}

/** Index of the word under a source time, or -1. */
export function wordAtSource(words: Word[], srcMs: number): number {
  let lo = 0
  let hi = words.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (srcMs < words[mid].startMs) hi = mid - 1
    else if (srcMs >= words[mid].endMs) lo = mid + 1
    else return mid
  }
  return -1
}

/** Shift track-local word times onto the source timeline. */
export const toTrackTime = (words: Word[], trackOffsetMs: number): Word[] =>
  words.map((w) => ({ ...w, startMs: w.startMs + trackOffsetMs, endMs: w.endMs + trackOffsetMs }))
