import { execFile } from 'child_process'
import ffprobeStatic from 'ffprobe-static'
import { join } from 'path'
import { relativeOffsets } from '../../shared/edit'
import type { RecordingManifest, TrackKind } from '../../shared/types'

export const ffprobePath = (): string => ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked')

const run = (args: string[]): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(ffprobePath(), args, { windowsHide: true, maxBuffer: 256 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout))
    )
  )

/** From `pts_time,duration_time` CSV lines: the end of the latest packet, in seconds. */
export function lastPacketEndSeconds(csv: string): number {
  let end = 0
  for (const line of csv.split(/\r?\n/)) {
    const [pts, dur] = line.split(',').map(Number)
    if (Number.isFinite(pts)) end = Math.max(end, pts + (Number.isFinite(dur) ? dur : 0))
  }
  return end
}

/**
 * Duration of a media file. Live-mode WebM (what MediaRecorder writes, and what a crash leaves
 * behind) stores none, so fall back to scanning packet timestamps.
 */
export async function probeDurationSeconds(file: string): Promise<number> {
  const stored = Number((await run(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])).trim())
  if (Number.isFinite(stored) && stored > 0) return stored
  return lastPacketEndSeconds(
    await run(['-v', 'error', '-select_streams', '0', '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', file])
  )
}

/** Source length of a recording without a stored duration (recovered after a crash). */
export async function probeSourceMs(dir: string, m: RecordingManifest): Promise<number> {
  const offsets = relativeOffsets(m)
  const ends = await Promise.all(
    (Object.entries(m.tracks) as [TrackKind, { file: string }][]).map(async ([k, t]) => {
      const secs = await probeDurationSeconds(join(dir, t.file)).catch(() => 0)
      return (offsets[k] ?? 0) + secs * 1000
    })
  )
  return Math.max(...ends, 100)
}
