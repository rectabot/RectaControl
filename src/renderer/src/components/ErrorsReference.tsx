import { useMemo, useState } from 'react'
import { listAlarms, listErrors, type CodeGroup, type RecoveryAction, type ResolvedCode } from '@shared/messages'
import { useStore } from '../store'
import { useLang, useT } from '../i18n'
import { AlertIcon } from './icons'

/** Order the error groups appear in, so related codes sit together. */
const ERROR_GROUPS: CodeGroup[] = ['motion', 'state', 'gcode', 'system', 'file', 'macro', 'other']

/** Searchable, grouped catalogue of every grblHAL alarm and error, each with a
 *  plain-language "when it happens" + "what to do", and the quick-recovery
 *  actions (Unlock / Home / Reset) that apply. Shown as a settings category and
 *  reused by the status-bar "what do I do?" popup. */
export function ErrorsReference({ filter = '' }: { filter?: string }): JSX.Element {
  const t = useT()
  const lang = useLang()
  const recoveryPopup = useStore((s) => s.recoveryPopup)
  const setRecoveryPopup = useStore((s) => s.setRecoveryPopup)
  const [local, setLocal] = useState('')
  const q = (filter || local).trim().toLowerCase()

  const alarms = useMemo(() => listAlarms(lang), [lang])
  const errors = useMemo(() => listErrors(lang), [lang])

  const match = (c: ResolvedCode, prefix: string): boolean =>
    !q ||
    `${prefix}${c.code}`.toLowerCase().includes(q) ||
    String(c.code) === q ||
    c.title.toLowerCase().includes(q) ||
    c.cause.toLowerCase().includes(q) ||
    c.recovery.toLowerCase().includes(q)

  const shownAlarms = alarms.filter((a) => match(a, 'alarm:'))
  const shownErrors = errors.filter((e) => match(e, 'error:'))

  // group the surviving errors, preserving ERROR_GROUPS order
  const errorGroups = ERROR_GROUPS.map((g) => ({
    group: g,
    items: shownErrors.filter((e) => e.group === g)
  })).filter((s) => s.items.length > 0)

  const nothing = shownAlarms.length === 0 && shownErrors.length === 0

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* only show a local search when the parent isn't already filtering */}
      {!filter && (
        <input
          className="input w-full text-sm"
          placeholder={t('ui.errors.search')}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
        />
      )}

      {/* preference: auto-open the recovery popup (experienced users can turn it
          off — the footer notice + "what do I do?" button stay either way) */}
      {!q && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-panel2 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm text-slate-200">{t('ui.errors.autoPopup')}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-slate-500">
              {t('ui.errors.autoPopupHint')}
            </div>
          </div>
          <button
            onClick={() => setRecoveryPopup(!recoveryPopup)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${recoveryPopup ? 'bg-ok' : 'bg-border2'}`}
            title={recoveryPopup ? t('ui.toggle.on') : t('ui.toggle.off')}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${recoveryPopup ? 'left-[22px]' : 'left-0.5'}`}
            />
          </button>
        </div>
      )}

      {shownAlarms.length > 0 && (
        <Section
          title={t('ui.errors.alarmsTitle')}
          hint={t('ui.errors.alarmsHint')}
          prefix="ALARM"
          badgeColor="text-danger"
          items={shownAlarms}
          open={!!q}
        />
      )}

      {errorGroups.length > 0 && (
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-brand">
              <AlertIcon className="h-4 w-4" />
              {t('ui.errors.errorsTitle')}
            </h3>
            <p className="mt-1 text-[11px] leading-snug text-slate-500">{t('ui.errors.errorsHint')}</p>
          </div>
          {errorGroups.map((g) => (
            <Section
              key={g.group}
              title={t(`ui.errors.group.${g.group}`)}
              prefix="error"
              badgeColor="text-warn"
              items={g.items}
              open={!!q}
              sub
            />
          ))}
        </div>
      )}

      {nothing && (
        <div className="p-6 text-center font-mono text-sm text-slate-500">
          {t('ui.settings.noResults', { query: filter || local })}
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  hint,
  prefix,
  badgeColor,
  items,
  open,
  sub
}: {
  title: string
  hint?: string
  prefix: string
  badgeColor: string
  items: ResolvedCode[]
  open: boolean
  sub?: boolean
}): JSX.Element {
  return (
    <section>
      <h3
        className={
          sub
            ? 'mb-2 font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400'
            : 'mb-1 flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-brand'
        }
      >
        {!sub && <AlertIcon className="h-4 w-4" />}
        {title}
      </h3>
      {hint && <p className="mb-2 text-[11px] leading-snug text-slate-500">{hint}</p>}
      <div className="overflow-hidden rounded-lg border border-border">
        {items.map((it, i) => (
          <CodeCard
            key={it.code}
            item={it}
            prefix={prefix}
            badgeColor={badgeColor}
            defaultOpen={open}
            last={i === items.length - 1}
          />
        ))}
      </div>
    </section>
  )
}

function CodeCard({
  item,
  prefix,
  badgeColor,
  defaultOpen,
  last
}: {
  item: ResolvedCode
  prefix: string
  badgeColor: string
  defaultOpen: boolean
  last: boolean
}): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={last ? '' : 'border-b border-border/60'}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-panel2"
      >
        <span className={`w-24 shrink-0 font-mono text-xs ${badgeColor}`}>
          {prefix}:{item.code}
        </span>
        <span className="flex-1 text-sm text-slate-200">{item.title}</span>
        {item.actions?.map((a) => (
          <ActionBadge key={a} action={a} />
        ))}
        <Chevron open={open} />
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3 pl-[7.5rem] pr-3 text-[13px] leading-snug">
          {item.cause && (
            <p className="text-slate-400">
              <span className="mr-1.5 font-semibold uppercase tracking-wide text-slate-500 text-[10px]">
                {t('ui.errors.cause')}
              </span>
              {item.cause}
            </p>
          )}
          {item.recovery && (
            <p className="text-slate-300">
              <span className="mr-1.5 font-semibold uppercase tracking-wide text-brand/80 text-[10px]">
                {t('ui.errors.recovery')}
              </span>
              {item.recovery}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Small pill showing which quick-recovery action applies to a code. */
function ActionBadge({ action }: { action: RecoveryAction }): JSX.Element {
  const t = useT()
  const tone =
    action === 'reset'
      ? 'border-danger/40 text-danger'
      : action === 'home'
        ? 'border-ok/40 text-ok'
        : 'border-warn/40 text-warn'
  return (
    <span
      className={`hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] sm:inline ${tone}`}
    >
      {t(`ui.errors.act.${action}`)}
    </span>
  )
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  )
}
