import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { installWhisper, systemTar, whisperStatus, type Sources } from '../../src/main/whisper/install'

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

let server: Server
let base: string
let zip: Buffer
let model: Buffer
let requests: string[]
let slow = false

beforeAll(async () => {
  // A zip shaped like the real release: Release/whisper-cli.exe + a DLL.
  const work = mkdtempSync(join(tmpdir(), 'lev-zip-'))
  mkdirSync(join(work, 'Release'))
  writeFileSync(join(work, 'Release', 'whisper-cli.exe'), 'stub exe')
  writeFileSync(join(work, 'Release', 'whisper.dll'), 'stub dll')
  execFileSync(systemTar(), ['-a', '-cf', join(work, 'engine.zip'), '-C', work, 'Release'])
  zip = readFileSync(join(work, 'engine.zip'))
  model = Buffer.alloc(200_000, 7)
  server = createServer((req, res) => {
    requests.push(req.url!)
    if (req.url === '/broken') {
      res.statusCode = 500
      return res.end('nope')
    }
    const body = req.url === '/engine.zip' ? zip : req.url === '/model.bin' ? model : null
    if (!body) {
      res.statusCode = 404
      return res.end()
    }
    res.setHeader('content-length', body.length)
    if (!slow) return res.end(body)
    // Trickle so a test can cancel mid-download.
    let i = 0
    const t = setInterval(() => {
      if (i >= body.length || res.destroyed) {
        clearInterval(t)
        return res.end()
      }
      res.write(body.subarray(i, i + 1000))
      i += 1000
    }, 20)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => server.close())

let root: string
beforeEach(() => {
  root = join(mkdtempSync(join(tmpdir(), 'lev-whisper-')), 'whisper')
  requests = []
  slow = false
})

const sources = (patch: Partial<{ engineUrl: string; engineSha: string; modelSha: string }> = {}): Sources => ({
  engine: { url: base + (patch.engineUrl ?? '/engine.zip'), sha256: patch.engineSha ?? sha(zip), size: zip.length },
  model: { url: `${base}/model.bin`, sha256: patch.modelSha ?? sha(model), size: model.length }
})

describe('installWhisper', () => {
  test('fresh install downloads, verifies and unpacks both', async () => {
    expect(whisperStatus(root)).toMatchObject({ engine: false, model: false })
    const stages = new Set<string>()
    await installWhisper(root, { sources: sources(), onProgress: (s) => stages.add(s) })
    expect(whisperStatus(root)).toMatchObject({ engine: true, model: true })
    expect(readFileSync(join(root, 'bin', 'whisper-cli.exe'), 'utf8')).toBe('stub exe')
    expect(existsSync(join(root, 'bin', 'whisper.dll'))).toBe(true)
    expect([...stages]).toEqual(['engine', 'model'])
    // No leftovers.
    expect(readdirSync(root).sort()).toEqual(['bin', 'installed.json', 'models'])
  })

  test('hash mismatch deletes the part file and throws with the file name', async () => {
    await expect(installWhisper(root, { sources: sources({ modelSha: 'bad' }), onProgress: () => {} })).rejects.toThrow(
      'Download check failed for ggml-base.bin'
    )
    expect(whisperStatus(root).model).toBe(false)
    expect(readdirSync(join(root, 'models'))).toEqual([])
  })

  test('server error throws and leaves no partial install', async () => {
    await expect(installWhisper(root, { sources: sources({ engineUrl: '/broken' }), onProgress: () => {} })).rejects.toThrow(
      /Download failed for the speech engine \(HTTP 500\)/
    )
    expect(whisperStatus(root)).toMatchObject({ engine: false, model: false })
    expect(existsSync(join(root, 'bin'))).toBe(false)
  })

  test('second install with everything present downloads nothing', async () => {
    await installWhisper(root, { sources: sources(), onProgress: () => {} })
    requests = []
    await installWhisper(root, { sources: sources(), onProgress: () => {} })
    expect(requests).toEqual([])
  })

  test('cancel aborts and cleans the part file', async () => {
    slow = true
    const ac = new AbortController()
    const p = installWhisper(root, { sources: sources(), signal: ac.signal, onProgress: (stage, pct) => stage === 'model' && pct > 5 && ac.abort() })
    await expect(p).rejects.toThrow(/cancel/i)
    expect(whisperStatus(root).model).toBe(false)
    expect(readdirSync(join(root, 'models'))).toEqual([])
  }, 30_000)
})
