import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Where the panel opens relative to its trigger. */
type Placement = 'bottom-left' | 'bottom-right' | 'top-right' | 'top-left'

const POS: Record<Placement, string> = {
  'bottom-left': 'left-0 top-full mt-1.5',
  'bottom-right': 'right-0 top-full mt-1.5',
  'top-right': 'right-0 bottom-full mb-1.5',
  'top-left': 'left-0 bottom-full mb-1.5'
}

const OPEN_MS = 160 // hover dwell before it appears — stops popovers flashing while you scan
const CLOSE_MS = 220 // grace on leave — lets the pointer cross the gap into the panel

/**
 * The app's one explanation popover. A quiet ⓘ that teaches on demand: hovering
 * reveals it after a short dwell, clicking PINS it open (so you can read at your own
 * pace, select text, or press the action button without it vanishing under you).
 *
 * Used for the reference rows in the offsets table, the "What is WCS?" help in the
 * DRO, and the Park setup hint — one look, one behaviour, everywhere.
 */
export function InfoTip({
  title,
  body,
  note,
  action,
  placement = 'bottom-left',
  width = 'w-80',
  trigger,
  triggerTitle,
  className = ''
}: {
  title: string
  /** paragraphs, in reading order: what it is → when you use it */
  body: string[]
  /** dimmed closing line — a caveat or a "watch out for this" */
  note?: string
  /** optional call to action, e.g. "→ Work offsets" */
  action?: { label: string; onClick: () => void }
  placement?: Placement
  width?: string
  /** custom trigger; omit for the default ⓘ dot */
  trigger?: (open: boolean) => ReactNode
  triggerTitle?: string
  /** extra classes for the wrapper — e.g. `h-full w-full` when the trigger is a big button */
  className?: string
}): JSX.Element {
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const open = hover || pinned

  // Only the small ⓘ dot reveals on hover — it exists purely to be asked. A custom
  // trigger is a real control sitting in a busy area (the WCS strip, the Park button),
  // and a panel flashing open while you reach past it is noise, so those open on click.
  // That click is also the perfect moment: you pressed Park because you WANTED to park.
  const hoverOpens = !trigger

  useEffect(() => () => clearTimeout(timer.current), [])

  const schedule = (to: boolean): void => {
    if (!hoverOpens) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setHover(to), to ? OPEN_MS : CLOSE_MS)
  }

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => schedule(true)}
      onMouseLeave={() => schedule(false)}
    >
      <button
        type="button"
        // a custom trigger brings its own look; the default ⓘ dot is styled below
        className={trigger ? 'h-full w-full outline-none' : 'inline-flex items-center justify-center outline-none'}
        title={triggerTitle}
        onClick={(e) => {
          e.stopPropagation()
          setPinned((p) => !p)
        }}
      >
        {trigger ? (
          trigger(open)
        ) : (
          <span
            className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold leading-none transition ${
              open ? 'border-brand bg-brand/10 text-brand' : 'border-border2 text-slate-500 hover:text-brand'
            }`}
          >
            i
          </span>
        )}
      </button>

      {/* click-outside catcher — only while PINNED, so a passing hover never eats clicks */}
      {pinned && (
        <span
          className="fixed inset-0 z-40"
          onClick={(e) => {
            e.stopPropagation()
            setPinned(false)
            setHover(false)
          }}
        />
      )}

      {open && (
        <span
          // font-sans / normal-case / tracking-normal / whitespace-normal defend the
          // panel against the labels it hangs off — table cells are mono, uppercase and
          // `whitespace-nowrap`, and every one of those would leak in and ruin the text
          className={`absolute z-50 ${POS[placement]} ${width} cursor-default whitespace-normal break-words rounded-lg border border-border bg-panel p-3 text-left font-sans text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-300 shadow-glow`}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="mb-1 block font-display text-[13px] font-bold text-brand">{title}</span>
          {body.map((p, i) => (
            <span key={i} className="mb-2 block">
              {p}
            </span>
          ))}
          {note && <span className="block text-slate-500">{note}</span>}
          {action && (
            <button
              type="button"
              className="mt-2.5 w-full rounded-md border border-brand/50 bg-panel2 py-1.5 text-[11px] font-semibold text-brand transition hover:bg-brand hover:text-[#020617]"
              onClick={(e) => {
                e.stopPropagation()
                setPinned(false)
                setHover(false)
                action.onClick()
              }}
            >
              {action.label}
            </button>
          )}
        </span>
      )}
    </span>
  )
}
