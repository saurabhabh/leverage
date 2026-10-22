import { readFileSync, renameSync, writeFileSync } from 'fs'

export type Provider = 'groq' | 'openrouter'

export type Cipher = {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

/**
 * API keys, encrypted with the OS (Electron safeStorage → Windows DPAPI). Only the main process
 * reads them; renderers can set a key or ask whether one exists, never read it back.
 */
export class KeyStore {
  constructor(
    private file: string,
    private cipher: Cipher
  ) {}

  private read(): Partial<Record<Provider, string>> {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'))
      return raw && typeof raw === 'object' ? raw : {}
    } catch {
      return {}
    }
  }

  private write(data: Partial<Record<Provider, string>>): void {
    const temp = `${this.file}.tmp`
    writeFileSync(temp, JSON.stringify(data))
    renameSync(temp, this.file)
  }

  set(p: Provider, key: string): void {
    const data = this.read()
    const trimmed = key.trim()
    if (!trimmed) delete data[p]
    else {
      if (!this.cipher.available()) throw new Error('Secure storage is not available on this PC')
      data[p] = this.cipher.encrypt(trimmed).toString('base64')
    }
    this.write(data)
  }

  get(p: Provider): string | null {
    const enc = this.read()[p]
    if (!enc || !this.cipher.available()) return null
    try {
      return this.cipher.decrypt(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  has(p: Provider): boolean {
    return !!this.read()[p]
  }
}
