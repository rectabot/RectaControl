import type { RectaApi } from '@shared/types'

declare global {
  interface Window {
    recta: RectaApi
  }
}

export {}
