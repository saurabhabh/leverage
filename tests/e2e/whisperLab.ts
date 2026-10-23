import { cpSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

/** A verified whisper.cpp engine + base model kept in the git-ignored _lab folder (Windows dev PC). */
const LAB = resolve(__dirname, '..', '..', '_lab', 'whisper-dl')
export const haveEngine =
  existsSync(join(LAB, 'bin', 'Release', 'whisper-cli.exe')) &&
  existsSync(join(LAB, 'models', 'ggml-base.bin'))

/** Pre-install the engine and model into an isolated profile, as the in-app download would. */
export function preinstallWhisper(userData: string): void {
  mkdirSync(join(userData, 'whisper', 'models'), { recursive: true })
  cpSync(join(LAB, 'bin', 'Release'), join(userData, 'whisper', 'bin'), { recursive: true })
  cpSync(join(LAB, 'models', 'ggml-base.bin'), join(userData, 'whisper', 'models', 'ggml-base.bin'))
}

/** Chromium's fake microphone playing real speech ("Welcome…") instead of a beep. */
export const SPEECH_MIC = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${resolve(__dirname, '..', 'fixtures', 'speech.wav')}`
]
