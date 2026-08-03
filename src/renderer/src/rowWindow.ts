/**
 * Which rows of a long list to actually mount.
 *
 * The G-code view renders only what the viewport covers, plus overscan. A 4000-line
 * program moves its highlight ~20×/s during a job, and mounting every line on each of
 * those updates stalls the whole UI — the visualizer shares the thread.
 *
 * Kept out of the component, away from React and the store, because the property that
 * matters is arithmetic and it broke in a way nobody could see from the outside: on
 * 3 Aug 2026 Filip loaded a program and got an EMPTY editor, intermittently. The
 * offset had been left behind by the previous, longer program — nothing ever reset it
 * — and a window starting past the last line mounts no rows at all. An editor showing
 * nothing looks exactly like one that failed to load.
 *
 * Hence the clamp, and hence the test: whenever there is a line to show, this returns
 * a row to mount.
 */

/** Row height in px. Must match the `leading-5` the rows are rendered with — the view
 *  positions rows by index, so a fractional height would drift. */
export const ROW = 20
/** Rows kept mounted above and below the viewport, so ordinary scrolling and the
 *  line-by-line highlight never reach an unmounted row. */
export const OVERSCAN = 20
/** Viewport height to assume before the real one has been measured. Only ever used on
 *  the first paint; a too-small guess would mount too few rows to fill the panel. */
const ASSUMED_VIEW = 600

export interface RowWindow {
  /** First row index to mount (also `first * ROW` px of translate). */
  first: number
  /** One past the last row to mount. */
  last: number
}

/**
 * @param scrollTop  the scroll offset in px — may be stale or past the end
 * @param boxH       measured viewport height in px, 0 before it is known
 * @param count      total number of rows
 */
export function rowWindow(scrollTop: number, boxH: number, count: number): RowWindow {
  const view = boxH || ASSUMED_VIEW
  // Past the end of a shorter program the window would start beyond the last line.
  // Clamped, the worst a stale offset can do is show the last page instead of the first.
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, count * ROW - view))
  return {
    first: Math.max(0, Math.floor(top / ROW) - OVERSCAN),
    last: Math.min(count, Math.ceil((top + view) / ROW) + OVERSCAN)
  }
}
