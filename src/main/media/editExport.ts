import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { outputDurationMs, type EditDoc } from '../../shared/edit'
import type { RecordingManifest } from '../../shared/types'
import {
  buildConcatGifArgs,
  buildConcatMp4Args,
  buildSegmentArgs,
  hasExportAudio,
  planSegments
} from './editExportArgs'
import { frameSize, parseFfmpegProgress } from './exportArgs'

type Run = (args: string[], onStdoutLine?: (line: string) => void) => Promise<void>

export type ExportJob = {
  m: RecordingManifest
  e: EditDoc
  dir: string
  out: string
  kind: 'mp4' | 'gif'
  pngs: Record<string, string>
  mask: string | null
  run: Run
  onProgress: (pct: number) => void
}

/** Share of the progress bar spent rendering segments; the rest is the final join. */
const SEGMENT_SHARE = 0.9

const withProgress = (args: string[]): string[] => [...args.slice(0, -1), '-progress', 'pipe:1', '-nostats', args[args.length - 1]]

/**
 * Render each clip to its own segment, then join them. Segments live in a temporary folder inside
 * the recording, removed afterwards whether the export succeeds or not.
 */
export async function exportEdit(job: ExportJob): Promise<void> {
  const { m, e, dir, out, kind, run, onProgress } = job
  const total = Math.max(1, outputDurationMs(e))
  const segments = planSegments(e)
  const audio = kind === 'mp4' && hasExportAudio(m, e)
  const tmp = await mkdtemp(join(dir, '.export-'))
  try {
    const files: string[] = []
    for (const seg of segments) {
      const file = join(tmp, `seg${String(seg.index).padStart(4, '0')}.mkv`)
      const args = buildSegmentArgs(m, e, seg, dir, file, job.pngs, job.mask, { audio })
      await run(withProgress(args), (line) => {
        const pct = parseFfmpegProgress(line, seg.lenMs)
        if (pct !== null) onProgress(Math.round(((seg.outStartMs + (pct / 100) * seg.lenMs) / total) * 100 * SEGMENT_SHARE))
      })
      files.push(file)
    }
    const list = join(tmp, 'list.txt')
    // Forward slashes and single quotes: the concat demuxer's own syntax, independent of Windows paths.
    await writeFile(list, files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
    onProgress(Math.round(100 * SEGMENT_SHARE))
    const final =
      kind === 'mp4'
        ? buildConcatMp4Args(list, out, audio)
        : buildConcatGifArgs(list, out, { fps: 15, width: Math.min(960, frameSize(m).width) })
    await run(final)
    onProgress(100)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
