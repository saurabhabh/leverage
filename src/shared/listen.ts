import { z } from 'zod'

/** One dictation in the history. `text` is what was pasted (cleaned, or raw when cleanup was off/failed). */
export const DictationEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  durationMs: z.number(),
  engine: z.enum(['local', 'groq']),
  raw: z.string(),
  text: z.string(),
  cleaned: z.boolean(),
  pasted: z.boolean(),
  /** Set when the dictation failed; `audio` then says whether it can be retried. */
  error: z.string().optional(),
  audio: z.boolean().optional()
})
export type DictationEntry = z.infer<typeof DictationEntrySchema>

export type DictationPhase = 'idle' | 'recording' | 'transcribing' | 'done' | 'error'
export type DictationStatus = { phase: DictationPhase; message?: string; text?: string }

export const NoteDocSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('meeting') }),
    z.object({ kind: z.literal('recording'), recordingId: z.string(), title: z.string() })
  ]),
  status: z.enum(['recording', 'transcribing', 'summarizing', 'ready', 'error']),
  durationMs: z.number().optional(),
  /** Audio files in the note folder (meetings only). */
  tracks: z.object({ mic: z.string().optional(), system: z.string().optional() }),
  /** Your own notes; AI never writes here. */
  notes: z.string(),
  transcript: z.string().nullable(),
  summary: z.string().nullable(),
  error: z.string().optional(),
  warnings: z.array(z.string())
})
export type NoteDoc = z.infer<typeof NoteDocSchema>
export type NoteEntry = Pick<NoteDoc, 'id' | 'title' | 'createdAt' | 'status' | 'source'>
