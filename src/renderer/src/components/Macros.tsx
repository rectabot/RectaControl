import { useState } from 'react'
import { useStore, type Macro } from '../store'
import { useT } from '../i18n'

/** Macros tab — a library of named command sequences. Click one to run it (each
 *  non-empty line is sent in order); the editor adds / edits / deletes them. */
export function Macros(): JSX.Element {
  const t = useT()
  const macros = useStore((s) => s.macros)
  const setMacros = useStore((s) => s.setMacros)
  const connected = useStore((s) => s.connected)
  const jobRunning = useStore((s) => s.job.running)
  // editing state: a macro being edited, 'new', or null (list view)
  const [editing, setEditing] = useState<Macro | 'new' | null>(null)
  const [name, setName] = useState('')
  const [gcode, setGcode] = useState('')

  const run = (m: Macro): void => {
    if (!connected || jobRunning) return
    for (const line of m.gcode.split(/\r?\n/)) {
      const s = line.trim()
      if (s) window.recta.send(s)
    }
  }

  const startNew = (): void => {
    setEditing('new')
    setName('')
    setGcode('')
  }
  const startEdit = (m: Macro): void => {
    setEditing(m)
    setName(m.name)
    setGcode(m.gcode)
  }
  const cancel = (): void => setEditing(null)

  const save = (): void => {
    const nm = name.trim()
    if (!nm) return
    if (editing === 'new') {
      setMacros([...macros, { id: crypto.randomUUID(), name: nm, gcode }])
    } else if (editing) {
      setMacros(macros.map((m) => (m.id === editing.id ? { ...m, name: nm, gcode } : m)))
    }
    setEditing(null)
  }
  const remove = (id: string): void => {
    setMacros(macros.filter((m) => m.id !== id))
    setEditing(null)
  }

  if (editing) {
    return (
      <div className="flex h-full flex-col gap-3 p-3">
        <input
          className="input"
          placeholder={t('ui.macros.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <textarea
          className="input min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed"
          placeholder={t('ui.macros.gcodePlaceholder')}
          value={gcode}
          onChange={(e) => setGcode(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <button className="btn" onClick={save} disabled={!name.trim()}>
            {t('ui.macros.save')}
          </button>
          <button className="btn" onClick={cancel}>
            {t('ui.macros.cancel')}
          </button>
          {editing !== 'new' && (
            <button
              className="ml-auto rounded-md border border-danger/60 px-3 py-1.5 text-sm text-danger transition hover:bg-danger hover:text-white"
              onClick={() => remove(editing.id)}
            >
              {t('ui.macros.delete')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {macros.length === 0 && (
          <div className="p-6 text-center text-sm leading-relaxed text-slate-500">{t('ui.macros.empty')}</div>
        )}
        {macros.map((m) => (
          <div key={m.id} className="flex items-center gap-2">
            <button
              onClick={() => run(m)}
              disabled={!connected || jobRunning}
              title={t('ui.macros.runTitle')}
              className="flex-1 truncate rounded-md border border-brand/50 bg-panel2 px-3 py-2 text-left text-sm font-semibold text-brand transition enabled:hover:bg-brand enabled:hover:text-[#020617] disabled:opacity-40"
            >
              {m.name}
            </button>
            <button
              onClick={() => startEdit(m)}
              className="shrink-0 rounded-md border border-border2 px-2 py-2 text-xs text-slate-400 transition hover:border-brand hover:text-brand"
              title={t('ui.macros.edit')}
            >
              ✎
            </button>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-2">
        <button className="btn w-full" onClick={startNew}>
          ＋ {t('ui.macros.new')}
        </button>
      </div>
    </div>
  )
}
