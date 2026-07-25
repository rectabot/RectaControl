import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { ACTIONS, ACTION_GROUPS, keyLabel } from '../controls'

type Capture = { id: string; col: 'key' | 'pad' } | null

function firstPad(): Gamepad | null {
  const pads = navigator.getGamepads?.() ?? []
  for (const p of pads) if (p) return p
  return null
}

/** Settings → Controls. One row per action with an editable Keyboard + Gamepad
 *  binding (click a cell, then press the key / button). Drives the global
 *  keyboard + gamepad runtimes. */
export function ControlsSettings(): JSX.Element {
  const t = useT()
  const controls = useStore((s) => s.controls)
  const setControls = useStore((s) => s.setControls)
  const resetControls = useStore((s) => s.resetControls)
  const hasA = useStore((s) => s.info.axes.includes('A'))
  const [capturing, setCapturing] = useState<Capture>(null)

  const bindings = controls.bindings

  const setBinding = (id: string, col: 'key' | 'pad', value: string | number): void => {
    const b: typeof bindings = {}
    // drop this key/button from any other action so a binding is unique
    for (const [k, v] of Object.entries(bindings)) {
      b[k] = v[col] === value ? { ...v, [col]: undefined } : { ...v }
    }
    b[id] = { ...b[id], [col]: value }
    setControls({ bindings: b })
  }
  const clearBinding = (id: string, col: 'key' | 'pad'): void => {
    setControls({ bindings: { ...bindings, [id]: { ...bindings[id], [col]: undefined } } })
  }

  // keyboard capture: grab the next key (capture phase, so the global jog
  // handler doesn't also fire); Esc cancels
  useEffect(() => {
    if (capturing?.col !== 'key') return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key !== 'Escape') setBinding(capturing.id, 'key', e.key)
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing])

  // gamepad capture: wait for a button that wasn't already held; Esc / timeout cancels
  useEffect(() => {
    if (capturing?.col !== 'pad') return
    let raf = 0
    const start = Date.now()
    const baseline = new Set<number>()
    const pad0 = firstPad()
    if (pad0) pad0.buttons.forEach((b, i) => b.pressed && baseline.add(i))
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    const poll = (): void => {
      const pad = firstPad()
      if (pad) {
        for (let i = 0; i < pad.buttons.length; i++) {
          if (pad.buttons[i].pressed && !baseline.has(i)) {
            setBinding(capturing.id, 'pad', i)
            setCapturing(null)
            return
          }
          if (!pad.buttons[i].pressed) baseline.delete(i)
        }
      }
      if (Date.now() - start > 10000) return setCapturing(null)
      raf = requestAnimationFrame(poll)
    }
    raf = requestAnimationFrame(poll)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing])

  const rows = ACTIONS.filter((a) => hasA || (a.axis !== 'A'))

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* enable toggles — jog mode / feed / step live in the Jog panel now */}
      <section className="grid gap-2">
        <Row label={t('ui.controls.enable')} hint={t('ui.controls.enableHint')}>
          <Toggle on={controls.keyboard} onClick={() => setControls({ keyboard: !controls.keyboard })} />
        </Row>
        <Row label={t('ui.controls.gamepadEnable')} hint={t('ui.controls.gamepadEnableHint')}>
          <Toggle on={controls.gamepad} onClick={() => setControls({ gamepad: !controls.gamepad })} />
        </Row>
      </section>

      {/* bindings table: Action | Keyboard | Gamepad */}
      <section>
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-3 border-b border-border bg-panel2 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span className="flex-1">{t('ui.controls.col.action')}</span>
            <span className="w-28 text-center">{t('ui.controls.col.keyboard')}</span>
            <span className="w-28 text-center">{t('ui.controls.col.gamepad')}</span>
          </div>

          {ACTION_GROUPS.map((g) => {
            const groupRows = rows.filter((a) => a.group === g)
            if (!groupRows.length) return null
            return (
              <div key={g}>
                <div className="bg-panel2/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  {t(`ui.controls.group.${g}`)}
                </div>
                {groupRows.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 border-t border-border/50 px-3 py-1.5">
                    <span className="flex-1 text-sm text-slate-200">{t(a.labelKey)}</span>
                    <div className="w-28">
                      <BindCell
                        label={keyLabel(bindings[a.id]?.key)}
                        bound={bindings[a.id]?.key != null}
                        capturing={capturing?.id === a.id && capturing.col === 'key'}
                        prompt={t('ui.controls.pressKey')}
                        onClick={() => setCapturing({ id: a.id, col: 'key' })}
                        onClear={() => clearBinding(a.id, 'key')}
                      />
                    </div>
                    <div className="w-28">
                      <BindCell
                        label={
                          bindings[a.id]?.pad != null ? t('ui.controls.padBtn', { n: bindings[a.id]!.pad! }) : '—'
                        }
                        bound={bindings[a.id]?.pad != null}
                        capturing={capturing?.id === a.id && capturing.col === 'pad'}
                        prompt={t('ui.controls.pressBtn')}
                        onClick={() => setCapturing({ id: a.id, col: 'pad' })}
                        onClear={() => clearBinding(a.id, 'pad')}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-slate-500">{t('ui.controls.focusNote')}</p>
      </section>

      {/* reset every binding + jog setting to the built-in defaults */}
      <div className="flex justify-end border-t border-border pt-4">
        <button
          onClick={resetControls}
          className="rounded-md border border-border2 px-3 py-1.5 text-xs text-slate-300 transition hover:border-danger hover:text-danger"
        >
          {t('ui.controls.reset')}
        </button>
      </div>
    </div>
  )
}

/** A binding cell: shows the current key/button, click to (re)capture, × to clear. */
function BindCell({
  label,
  bound,
  capturing,
  prompt,
  onClick,
  onClear
}: {
  label: string
  bound: boolean
  capturing: boolean
  prompt: string
  onClick: () => void
  onClear: () => void
}): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-1">
      <button
        onClick={onClick}
        className={`min-w-0 flex-1 truncate rounded border px-2 py-1 text-center font-mono text-[11px] transition ${
          capturing
            ? 'animate-pulse border-brand bg-brand/10 text-brand'
            : bound
              ? 'border-border2 bg-panel2 text-slate-200 hover:border-brand'
              : 'border-border2 bg-panel2 text-slate-500 hover:border-brand'
        }`}
      >
        {capturing ? prompt : label}
      </button>
      {bound && !capturing && (
        <button className="shrink-0 text-slate-600 hover:text-danger" onClick={onClear} title="✕">
          ✕
        </button>
      )}
    </div>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  const t = useT()
  return (
    <button
      onClick={onClick}
      className={`relative h-6 w-11 rounded-full transition ${on ? 'bg-ok' : 'bg-border2'}`}
      title={on ? t('ui.toggle.on') : t('ui.toggle.off')}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`}
      />
    </button>
  )
}
