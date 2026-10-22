import { spawn } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'

/** ffmpeg-static resolves inside app.asar when packaged; the binary itself is unpacked beside it. */
export const ffmpegPath = (): string => {
  if (!ffmpegStatic) throw new Error('ffmpeg binary not available for this platform')
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
}

/** Spawn ffmpeg; resolve on exit 0, otherwise reject with the last 20 stderr lines. */
export function execFfmpeg(args: string[], onStdoutLine?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true })
    const stderr: string[] = []
    let pending = ''
    child.stdout.on('data', (buf: Buffer) => {
      pending += buf.toString()
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      if (onStdoutLine) lines.forEach(onStdoutLine)
    })
    child.stderr.on('data', (buf: Buffer) => {
      stderr.push(...buf.toString().split(/\r?\n/).filter(Boolean))
      if (stderr.length > 200) stderr.splice(0, stderr.length - 200)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with ${code}\n${stderr.slice(-20).join('\n')}`))
    })
  })
}

/** Stream-copy a WebM so it gets a duration and seek cues. */
export const remuxCopy = (inFile: string, outFile: string): Promise<void> =>
  execFfmpeg(['-hide_banner', '-loglevel', 'error', '-i', inFile, '-c', 'copy', '-n', outFile])
