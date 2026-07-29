import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'

/** Shared text styling so the editor's textarea, its highlight layer and the
 *  read-only view line up character-for-character. `leading-5` = an INTEGER 20 px
 *  row height: a fractional line-height (e.g. leading-relaxed → 19.5 px) makes
 *  successive rows round to 19/20 px alternately, so the moving highlight visibly
 *  wobbles a pixel or two — an integer height keeps every row identical. */
const CELL = 'font-mono text-xs leading-5'

/** Row height in px — the integer `leading-5` above. The read-only view renders
 *  only the rows in view and positions them by index, which needs this to be an
 *  exact, uniform number. */
const ROW = 20
/** Rows kept mounted above and below the viewport, so ordinary scrolling and the
 *  line-by-line highlight never reach an unmounted row. */
const OVERSCAN = 20

/** G-code view. Read-only by default (syntax colors, current-line highlight and
 *  auto-scroll to the executing line, kept aligned with the toolpath arrow via
 *  `activeLine`). An Edit mode swaps in a syntax-highlighted editor (with line
 *  numbers) so the loaded program can be tweaked and saved back — disabled while
 *  a job is running. */
export function GcodePreview(): JSX.Element {
  const t = useT()
  const gcode = useStore((s) => s.gcode)
  const filename = useStore((s) => s.filename)
  const libFile = useStore((s) => s.libFile)
  const sdSource = useStore((s) => s.sdSource)
  const isEth = useStore((s) => s.connKind === 'ethernet')
  const setFile = useStore((s) => s.setFile)
  const updateGcode = useStore((s) => s.updateGcode)
  const pushConsole = useStore((s) => s.pushConsole)
  const rawActive = useStore((s) => s.activeLine)
  const running = useStore((s) => s.job.running)
  // While parked (job aborted to Idle for jogging), `activeLine` resets to -1 and the
  // highlight would vanish. Hold it on the parked line so the line you stopped on
  // stays visible the whole time you're parked, then hand back to the live line on resume.
  const parked = useStore((s) => s.parked)
  const parkLine = useStore((s) => s.parkLine)
  const activeIndex = parked && parkLine >= 0 ? parkLine : rawActive
  const scrollBoxRef = useRef<HTMLDivElement>(null)
  // Scroll position + viewport height drive which rows are mounted. A streaming job
  // moves the highlight ~20×/s, and mounting every line of a 4000-line program on
  // each of those updates (each one re-running colorize()) stalls the whole UI —
  // the visualizer shares this thread, and the backlog kept the display moving long
  // after the machine had stopped.
  const [scrollTop, setScrollTop] = useState(0)
  const [boxH, setBoxH] = useState(0)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saveAs, setSaveAs] = useState(false)
  const [saveName, setSaveName] = useState('')

  const lines = useMemo(() => (gcode ? gcode.split(/\r?\n/) : []), [gcode])

  // Track the viewport height (and follow panel resizes / terminal expand).
  useEffect(() => {
    const box = scrollBoxRef.current
    if (!box) return
    setBoxH(box.clientHeight)
    const ro = new ResizeObserver(() => setBoxH(box.clientHeight))
    ro.observe(box)
    return () => ro.disconnect()
  }, [editing])

  useEffect(() => {
    // Keep the executing line pinned to the MIDDLE of the viewport, the way most
    // senders do: the highlight moves down with the program until it reaches the
    // centre, then stays there while the code scrolls up line-by-line under it.
    // Clamp ≥ 0 so the early lines (which can't scroll above the top) just sit where
    // they are until the centre is reached. Set scrollTop directly (instant, not a
    // smooth animation) so rapid consecutive line changes don't stack/jitter.
    // Computed from the row index rather than measured off the element: with only
    // the visible window mounted, the active row's node may not exist yet, and the
    // arithmetic is exact anyway because every row is exactly ROW px tall.
    if (editing || activeIndex < 0) return
    const box = scrollBoxRef.current
    if (!box) return
    const target = activeIndex * ROW - box.clientHeight / 2 + ROW / 2
    box.scrollTop = Math.max(0, Math.round(target))
  }, [activeIndex, editing])

  const startEdit = (): void => {
    setDraft(gcode ?? '')
    setSaveAs(false)
    setEditing(true)
  }
  // Save back to wherever the program came from: a PC library file is overwritten
  // on disk; an SD program is written back to the card (FTP — needs Ethernet);
  // a new / USB-loaded SD buffer falls back to a named Save-as into the library.
  const save = async (): Promise<void> => {
    // Always end with a newline: grblHAL appends "ok" right after the file dump
    // on `$F<=`, so a missing final newline merges the last line with "ok" and
    // the loader can't detect completion (it then waits out the timeout).
    const text = draft.endsWith('\n') ? draft : draft + '\n'
    try {
      if (libFile) {
        await window.recta.libWrite(libFile, text)
        updateGcode(text)
        pushConsole(t('ui.gc.savedLib', { name: libFile }))
        setEditing(false)
        return
      }
      if (sdSource && isEth) {
        await window.recta.fmUploadContent(localStorage.getItem('conn.ethHost') || '192.168.5.1', sdSource, text)
        updateGcode(text)
        pushConsole(t('ui.gc.savedSd', { name: sdSource }))
        setEditing(false)
        return
      }
      if (sdSource && !isEth) {
        pushConsole(t('ui.gc.sdNeedsEth'))
      }
      setSaveName((sdSource ?? filename ?? 'program.nc').replace(/^\//, ''))
      setSaveAs(true)
    } catch (e) {
      pushConsole(t('ui.gc.saveErr', { msg: (e as Error).message }))
    }
  }
  const confirmSaveAs = async (): Promise<void> => {
    let name = saveName.trim()
    if (!name) return
    if (!/\.[a-z0-9]+$/i.test(name)) name += '.nc'
    const text = draft.endsWith('\n') ? draft : draft + '\n'
    try {
      await window.recta.libWrite(name, text)
      setFile(name, text, name)
      pushConsole(t('ui.gc.savedLib', { name }))
      setSaveAs(false)
      setEditing(false)
    } catch (e) {
      pushConsole(t('ui.gc.saveErr', { msg: (e as Error).message }))
    }
  }
  const cancel = (): void => {
    setSaveAs(false)
    setEditing(false)
  }

  // ---- edit mode -----------------------------------------------------------
  if (editing) {
    const count = draft.split(/\r?\n/).filter((l) => l.trim()).length
    return (
      <div className="flex h-full flex-col bg-panel2">
        <div className="flex items-center gap-2 border-b border-border px-2 py-1">
          <span className="font-mono text-[11px] text-slate-400">✎ {libFile ?? filename ?? 'program.nc'}</span>
          <span className="font-mono text-[10px] text-slate-600">{t('ui.gc.lineCount', { n: count })}</span>
          <div className="ml-auto flex items-center gap-1">
            {saveAs ? (
              <>
                <span className="font-mono text-[10px] text-slate-500">{t('ui.gc.saveAs')}</span>
                <input
                  className="input w-40 !py-0.5 text-xs"
                  value={saveName}
                  spellCheck={false}
                  autoFocus
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmSaveAs()}
                />
                <button
                  className="rounded bg-brand px-2.5 py-1 text-xs font-semibold text-base transition hover:bg-brandDark"
                  onClick={confirmSaveAs}
                >
                  ✓
                </button>
                <button
                  className="rounded border border-border2 px-2 py-1 text-xs text-slate-300 transition hover:border-danger hover:text-danger"
                  onClick={() => setSaveAs(false)}
                >
                  ✕
                </button>
              </>
            ) : (
              <>
                <button
                  className="rounded bg-brand px-2.5 py-1 text-xs font-semibold text-base transition hover:bg-brandDark"
                  onClick={save}
                  title={
                    libFile
                      ? t('ui.gc.saveTitleLib', { name: libFile })
                      : sdSource
                        ? t('ui.gc.saveTitleSd', { name: sdSource })
                        : t('ui.gc.saveTitleDefault')
                  }
                >
                  {t('ui.gc.save')}
                </button>
                <button
                  className="rounded border border-border2 px-2.5 py-1 text-xs text-slate-300 transition hover:border-danger hover:text-danger"
                  onClick={cancel}
                >
                  {t('ui.gc.cancel')}
                </button>
              </>
            )}
          </div>
        </div>
        <CodeEditor value={draft} onChange={setDraft} />
      </div>
    )
  }

  // ---- read-only view ------------------------------------------------------
  if (!gcode) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 font-mono text-sm text-slate-600">
        {t('ui.gc.noProgram')}
        <button
          className="rounded-md border border-border2 px-3 py-1.5 text-xs text-slate-300 transition hover:border-brand hover:text-brand"
          onClick={startEdit}
        >
          {t('ui.gc.newProgram')}
        </button>
      </div>
    )
  }

  // the mounted window: what the viewport covers, plus overscan on both sides
  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN)
  const last = Math.min(lines.length, Math.ceil((scrollTop + (boxH || 600)) / ROW) + OVERSCAN)

  return (
    <div className="relative h-full">
      <button
        className="absolute right-2 top-2 z-10 rounded-md border border-border2 bg-panel/80 px-2.5 py-1 text-xs text-slate-300 backdrop-blur transition hover:border-brand hover:text-brand disabled:opacity-40"
        onClick={startEdit}
        disabled={running}
        title={running ? t('ui.gc.editDisabled') : t('ui.gc.editTitle')}
      >
        {t('ui.gc.edit')}
      </button>
      <div
        ref={scrollBoxRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className={`h-full overflow-y-auto overflow-x-hidden bg-panel2 px-2 py-1 ${CELL}`}
      >
        {/* full-height spacer preserves the real scrollbar; the mounted window is
            offset into place, so scrolling behaves exactly as with every row present */}
        <div style={{ height: lines.length * ROW }}>
          <div style={{ transform: `translateY(${first * ROW}px)` }}>
            {lines.slice(first, last).map((l, k) => {
              const i = first + k
              const active = i === activeIndex
              return (
                <div
                  key={i}
                  style={{ height: ROW }}
                  className={`flex gap-3 rounded px-1 ${active ? 'bg-brand/20' : ''}`}
                  // the full line on hover, since an over-long one is cut off below
                  title={l}
                >
                  <span className="w-10 shrink-0 select-none text-right text-slate-600">{i + 1}</span>
                  {/* Cut with an ellipsis rather than wrapped: every row here MUST be
                      exactly ROW px tall — the mounted window and the auto-scroll to
                      the executing line are both plain index × ROW arithmetic, and a
                      line that wrapped to two rows would send the highlight to the
                      wrong place on a long program. Edit mode shows the whole line. */}
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-pre">{colorize(l)}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Syntax-highlighted code editor with a line-number gutter. A transparent
 *  textarea drives input on top of a colorized highlight layer (so the text is
 *  preserved exactly), and the gutter + highlight follow the textarea's scroll. */
function CodeEditor({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const lines = value.split('\n')

  const onScroll = (): void => {
    const ta = taRef.current
    if (!ta) return
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop
      preRef.current.scrollLeft = ta.scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* line-number gutter (scrolls with the textarea) */}
      <div
        ref={gutterRef}
        className={`w-10 shrink-0 select-none overflow-hidden border-r border-border bg-panel2 py-1 text-right ${CELL}`}
      >
        {lines.map((_, i) => (
          <div key={i} className="px-1.5 text-slate-600">
            {i + 1}
          </div>
        ))}
      </div>

      {/* text area + highlight overlay */}
      <div className="relative min-w-0 flex-1">
        <pre
          ref={preRef}
          aria-hidden
          className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-2 py-1 ${CELL}`}
        >
          {lines.map((l, i) => (
            <div key={i}>{colorize(l)}</div>
          ))}
        </pre>
        <textarea
          ref={taRef}
          className={`absolute inset-0 resize-none overflow-auto whitespace-pre bg-transparent px-2 py-1 text-transparent caret-slate-100 outline-none ${CELL}`}
          value={value}
          spellCheck={false}
          wrap="off"
          onChange={(e) => onChange(e.target.value)}
          onScroll={onScroll}
          autoFocus
        />
      </div>
    </div>
  )
}

const TOKEN_RE = /\([^)]*\)|;.*$|[A-Za-z][-+0-9.]*/g

/** Colorize a line WITHOUT altering it: matched tokens get a color span, and
 *  everything in between (whitespace, separators, stray characters) is kept
 *  verbatim. The output text is identical to the input. */
function colorize(line: string): React.ReactNode {
  if (line === '') return ' '
  const out: React.ReactNode[] = []
  const re = new RegExp(TOKEN_RE)
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push(<span key={key++}>{line.slice(last, m.index)}</span>)
    out.push(
      <span key={key++} className={tokenColor(m[0])}>
        {m[0]}
      </span>
    )
    last = m.index + m[0].length
    if (m.index === re.lastIndex) re.lastIndex++ // guard against zero-width matches
  }
  if (last < line.length) out.push(<span key={key++}>{line.slice(last)}</span>)
  return out
}

function tokenColor(tok: string): string {
  if (tok.startsWith('(') || tok.startsWith(';')) return 'text-slate-500 italic'
  switch (tok[0].toUpperCase()) {
    case 'G':
      // G0 = rapid (non-cutting travel) → white, clearly set apart from the cutting
      // moves; G1/G2/G3 and modal G-codes stay brand cyan
      return parseInt(tok.slice(1), 10) === 0 ? 'text-white' : 'text-brand'
    case 'M':
      return 'text-purple'
    // per-axis colours matching the 3D viewer's R/G/B axes, so you can spot at a
    // glance which axis a word moves: X red, Y green, Z blue. Rotary (A/B/C) has no
    // firm convention → pink, kept clear of F's amber (they used to clash).
    case 'X':
      return 'text-red-400'
    case 'Y':
      return 'text-green-400'
    case 'Z':
      return 'text-blue-400'
    case 'A':
    case 'B':
    case 'C':
      return 'text-pink-400'
    case 'I':
    case 'J':
    case 'K':
    case 'R':
      return 'text-slate-400'
    case 'F':
      return 'text-warn'
    case 'S':
      return 'text-ok'
    case 'T':
      return 'text-sky-400'
    default:
      return 'text-slate-300'
  }
}
