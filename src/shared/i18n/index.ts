/**
 * Lightweight, dependency-free i18n. English is the canonical source: every key
 * exists in `en` and is the reference text. Other languages are override maps and
 * fall back to English for any missing key, so English is always complete/perfect.
 *
 * `t()` is pure (language passed in) so it works in shared code too; the renderer
 * binds the active language from the store via the `useT()` hook.
 */
import { en } from './en'
import { sr } from './sr'

export type Lang = 'en' | 'sr'

export const LANGUAGES: { code: Lang; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'sr', label: 'Srpski', flag: '🇷🇸' }
]

/** English is the base; each other language overrides only what it translates. */
export type Dict = Record<string, string>
const DICTS: Record<Lang, Dict> = { en, sr }

/**
 * Translate `key` into `lang`, falling back to English then to the raw key.
 * `params` fills `{name}` placeholders, e.g. t('loaded', 'en', { file: 'a.nc' }).
 */
export function t(key: string, lang: Lang, params?: Record<string, string | number>): string {
  const raw = DICTS[lang]?.[key] ?? en[key] ?? key
  return params ? raw.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`)) : raw
}

/** True when `lang` has its own entry for `key` (i.e. not just the English fallback). */
export function hasTranslation(key: string, lang: Lang): boolean {
  return lang === 'en' || DICTS[lang]?.[key] != null
}
