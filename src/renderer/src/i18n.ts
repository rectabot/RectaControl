/**
 * Renderer binding for the shared i18n layer. `useT()` returns a `t()` bound to the
 * store's active language, so components just call `t('key', { params })`. The
 * hook re-renders on language change because it subscribes to `s.lang`.
 */
import { useStore } from './store'
import { t as translate, type Lang } from '@shared/i18n'

export type TFunc = (key: string, params?: Record<string, string | number>) => string

export function useT(): TFunc {
  const lang = useStore((s) => s.lang)
  return (key, params) => translate(key, lang, params)
}

/**
 * English-locked resolver for CONTROL LABELS. The main UI — button / tab / control
 * labels (Home, Jog, Unlock, Feed, Spin, DRO axes, tab names …) — stays in English
 * for EVERY language. The commands are a small, worldwide-standard set; translating
 * them (e.g. Home → "Bazanje") only confuses. The chosen language instead drives the
 * DESCRIPTIONS shown as hover tooltips (via useT()) and all explanatory content
 * (Settings, guides, error/alarm help). So a control renders `L('key')` for its
 * fixed English label and `title={t('keyTitle')}` for its translated tooltip.
 */
export function useLabel(): TFunc {
  return (key, params) => translate(key, 'en', params)
}

export function useLang(): Lang {
  return useStore((s) => s.lang)
}
