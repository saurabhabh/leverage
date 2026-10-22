import { app, safeStorage } from 'electron'
import { join } from 'path'
import { handle } from '../ipc'
import { KeyStore } from '../secrets'

let store: KeyStore | null = null

export function keyStore(): KeyStore {
  store ??= new KeyStore(join(app.getPath('userData'), 'keys.json'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b)
  })
  return store
}

/** Write-only from renderers: they can set a key or see whether one exists, never read it. */
export function registerKeyIpc(): void {
  handle('ai:setKey', (_e, provider, key) => keyStore().set(provider, key))
  handle('ai:hasKeys', () => ({ groq: keyStore().has('groq'), openrouter: keyStore().has('openrouter') }))
}
