import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'

/** Terminal body — log + MDI input. Card chrome/tabs are provided by RightTabs. */

/** How many pasted lines the MDI will fire off. Beyond this it is a program in the
 *  wrong place — see send(). */
const MAX_PASTE = 20

/** HH:MM:SS, zero-padded, fixed-width — for the terminal timestamp column. */
function fmtTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function Console(): JSX.Element {
  const t = useT()
  const lines = useStore((s) => s.consoleLines)
  const connected = useStore((s) => s.connected)
  const jobRunning = useStore((s) => s.job.running)
  const pushConsole = useStore((s) => s.pushConsole)
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [hIdx, setHIdx] = useState(-1)
  const [copied, setCopied] = useState(false)
  // Off unless asked for. The timestamps earn their place while commissioning —
  // the ten seconds between `M3 S12000` and its `ok` is how you prove the spindle
  // ramp ($340) is real — but that is a day-one job, and the on-disk log carries
  // the same times to the millisecond for everything after it. Day to day the
  // column just costs the text width it needs.
  const [showTime, setShowTime] = useState(() => localStorage.getItem('consoleTime') === '1')
  const endRef = useRef<HTMLDivElement>(null)

  const toggleTime = (): void => {
    setShowTime((v) => {
      localStorage.setItem('consoleTime', v ? '0' : '1')
      return !v
    })
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [lines])

  /**
   * Send what is in the box, one machine line per line of text.
   *
   * Multi-line is ordinary: a short setup sequence, a snippet from a guide, three
   * lines somebody was given. The box used to be a single-line `<input>`, which let
   * the browser flatten a paste into one string with the newlines turned into spaces
   * — the board then saw one block holding three G53s and three G0s and answered
   * `error:21`, modal group violation. Correct, and completely opaque to whoever
   * pasted three perfectly ordinary lines and broke no such rule.
   *
   * Capped, because a paste that size is somebody putting a PROGRAM in the wrong
   * place, and the answer to that is the file loader, not a hundred MDI lines.
   */
  const send = (): void => {
    if (!connected) return
    const out = cmd
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (!out.length) return
    if (out.length > MAX_PASTE) {
      pushConsole(`* ${t('ui.console.pasteTooMany', { n: out.length, max: MAX_PASTE })}`)
      return
    }
    for (const line of out) window.recta.send(line)
    setHistory((h) => [...h, ...out])
    setHIdx(-1)
    setCmd('')
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter sends; Shift+Enter adds a line. Pasting therefore FILLS the box and
    // waits — on a machine that moves metal, Ctrl+V must not be the thing that
    // starts the motion. The first version of this fired on paste, terminal-style,
    // and Filip caught it within minutes of using it: every Ctrl+V sent the code.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
      return
    }
    // …and the history keys only while there is one line to replace. With a pasted
    // block in the box, Up and Down belong to the caret.
    if (cmd.includes('\n')) return
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const idx = hIdx < 0 ? history.length - 1 : Math.max(0, hIdx - 1)
      if (history[idx] !== undefined) {
        setHIdx(idx)
        setCmd(history[idx])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (hIdx >= 0 && hIdx < history.length - 1) {
        setHIdx(hIdx + 1)
        setCmd(history[hIdx + 1])
      } else {
        setHIdx(-1)
        setCmd('')
      }
    }
  }

  const fmtLine = (l: (typeof lines)[number]): string =>
    `${showTime ? fmtTime(l.time) + '  ' : ''}${l.text}${l.n > 1 ? ` (×${l.n})` : ''}`

  const copyAll = async (): Promise<void> => {
    if (!lines.length) return
    try {
      await navigator.clipboard.writeText(lines.map(fmtLine).join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <div className="absolute right-2 top-2 z-10 flex gap-1">
          <button
            className={`btn px-2 py-0.5 text-[10px] ${showTime ? 'border-brand text-brand' : 'opacity-70 hover:opacity-100'}`}
            onClick={toggleTime}
            title={t('ui.console.timeTitle')}
          >
            🕑
          </button>
          <button
            className="btn px-2 py-0.5 text-[10px] opacity-70 hover:opacity-100"
            onClick={copyAll}
            disabled={!lines.length}
            title={t('ui.console.copyTitle')}
          >
            {copied ? `✓ ${t('ui.console.copied')}` : `⧉ ${t('ui.console.copy')}`}
          </button>
        </div>
        {/* Long lines wrap instead of scrolling sideways. A terminal must never
            hide the end of what the machine said, and a horizontal scrollbar does
            exactly that — the tail of an `error:` or a `[MSG:…]` ends up off-screen
            in the one pane you read when something is wrong. The timestamp keeps its
            own column, so a wrapped line stays indented under its text. */}
        <div className="h-full select-text overflow-y-auto overflow-x-hidden bg-panel2 px-3 py-2 font-mono text-xs leading-relaxed">
          {lines.map((l, i) => (
            <div key={i} className={`flex gap-2 ${lineColor(l.text)}`}>
              {showTime && <span className="shrink-0 text-slate-600">{fmtTime(l.time)}</span>}
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                {l.text}
                {l.n > 1 && <span className="text-slate-500"> (×{l.n})</span>}
              </span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>
      <div className="flex gap-2 border-t border-border p-2">
        {/* A textarea, not an input, so a pasted sequence keeps its line breaks and
            can be READ before it is sent. One row until there is more to show, then
            up to six — past that the scrollbar takes over rather than the box eating
            the terminal it belongs to. */}
        <textarea
          className="input flex-1 resize-none"
          rows={Math.min(6, cmd.split('\n').length)}
          placeholder={jobRunning ? t('ui.console.mdiDisabled') : t('ui.console.mdiPlaceholder')}
          value={cmd}
          disabled={!connected || jobRunning}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={onKey}
        />
        <button className="btn" onClick={send} disabled={!connected || jobRunning}>
          {t('ui.console.send')}
        </button>
      </div>
    </div>
  )
}

function lineColor(l: string): string {
  if (l.startsWith('>')) return 'text-brand'
  if (l.startsWith('!') || /error|ALARM/i.test(l)) return 'text-danger'
  if (l.startsWith('*')) return 'text-slate-500'
  return 'text-slate-300'
}
