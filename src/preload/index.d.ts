import type { LeverageApi } from '../shared/ipc'

declare global {
  interface Window {
    leverage: LeverageApi
  }
}
