import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, readFileSync } from 'fs'
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'

/**
 * whisper.cpp engine + model, installed once under <userData>/whisper after the user confirms.
 * Every download is hashed while it streams and only moved into place when the SHA-256 matches.
 */

export type Source = { url: string; sha256: string; size: number }
export type Sources = { engine: Source; model: Source }
export type InstallStatus = { engine: boolean; model: boolean; dir: string }

export const DEFAULT_SOURCES: Sources = {
  engine: {
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-blas-bin-x64.zip',
    sha256: 'b1158bd10edf92c9799149a6fc5d3e58da3f495241d6fb3423088130e88ffbf3',
    size: 21_715_607
  },
  model: {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    size: 147_951_465
  }
}

export const MODEL_FILE = 'ggml-base.bin'
export const cliPath = (root: string): string => join(root, 'bin', 'whisper-cli.exe')
export const modelPath = (root: string): string => join(root, 'models', MODEL_FILE)

type Installed = { engine?: string; model?: string }
const readInstalled = (root: string): Installed => {
  try {
    return JSON.parse(readFileSync(join(root, 'installed.json'), 'utf8'))
  } catch {
    return {}
  }
}

export function whisperStatus(root: string): InstallStatus {
  return { engine: existsSync(cliPath(root)), model: existsSync(modelPath(root)), dir: root }
}

class Cancelled extends Error {
  constructor() {
    super('Download cancelled')
  }
}

/** Stream `src` to `dest`, verifying size and SHA-256. On any failure the file is removed. */
async function download(
  src: Source,
  dest: string,
  label: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const part = `${dest}.part`
  try {
    let res: Response
    try {
      res = await fetch(src.url, { signal })
    } catch (err) {
      if (signal?.aborted) throw new Cancelled()
      throw new Error(`Could not download ${label} — check your internet connection`, { cause: err })
    }
    if (!res.ok || !res.body) throw new Error(`Download failed for ${label} (HTTP ${res.status})`)
    const hash = createHash('sha256')
    const out = createWriteStream(part)
    let got = 0
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        if (signal?.aborted) throw new Cancelled()
        hash.update(chunk)
        got += chunk.length
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
        onProgress(Math.min(99, Math.round((got / src.size) * 100)))
      }
    } catch (err) {
      if (signal?.aborted) throw new Cancelled()
      throw err
    } finally {
      await new Promise<void>((r) => out.end(() => r()))
    }
    if (hash.digest('hex') !== src.sha256) throw new Error(`Download check failed for ${label}`)
    await rename(part, dest)
    onProgress(100)
  } catch (err) {
    await rm(part, { force: true })
    throw err
  }
}

/** Windows' own bsdtar (System32) reads zip files; a Git/GNU tar earlier on PATH would not. */
export const systemTar = (): string => join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')

const untar = (zip: string, dir: string): Promise<void> =>
  new Promise((resolve, reject) =>
    execFile(systemTar(), ['-xf', zip, '-C', dir], { windowsHide: true }, (err) =>
      err ? reject(new Error('Could not unpack the speech engine', { cause: err })) : resolve()
    )
  )

/** Folder inside the unpacked zip that holds whisper-cli.exe (the release nests it in Release/). */
async function findCliDir(dir: string): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase() === 'whisper-cli.exe') return dir
  }
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const found = await findCliDir(join(dir, entry.name))
      if (found) return found
    }
  }
  return null
}

export async function installWhisper(
  root: string,
  opts: { onProgress: (stage: 'engine' | 'model', pct: number) => void; signal?: AbortSignal; sources?: Sources }
): Promise<void> {
  const src = opts.sources ?? DEFAULT_SOURCES
  await mkdir(root, { recursive: true })
  const installed = readInstalled(root)
  const record = (): Promise<void> => writeFile(join(root, 'installed.json'), JSON.stringify(installed))

  if (!(installed.engine === src.engine.sha256 && existsSync(cliPath(root)))) {
    const zip = join(root, 'engine.zip')
    const tmp = await mkdtemp(join(root, 'unpack-'))
    try {
      await download(src.engine, zip, 'the speech engine', (p) => opts.onProgress('engine', p), opts.signal)
      await untar(zip, tmp)
      const cliDir = await findCliDir(tmp)
      if (!cliDir) throw new Error('The speech engine download did not contain whisper-cli.exe')
      await rm(join(root, 'bin'), { recursive: true, force: true })
      await rename(cliDir, join(root, 'bin'))
      installed.engine = src.engine.sha256
      await record()
    } finally {
      await rm(tmp, { recursive: true, force: true })
      await rm(zip, { force: true })
    }
  }

  if (!(installed.model === src.model.sha256 && existsSync(modelPath(root)))) {
    await mkdir(join(root, 'models'), { recursive: true })
    await download(src.model, modelPath(root), MODEL_FILE, (p) => opts.onProgress('model', p), opts.signal)
    installed.model = src.model.sha256
    await record()
  }
}
