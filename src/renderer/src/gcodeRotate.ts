/**
 * Software workpiece-rotation for G-code.
 *
 * When a part is clamped slightly skewed, the Probe "Angle" mode measures the
 * tilt; this rotates the WHOLE program in the XY plane about the WORK ORIGIN
 * (program X0 Y0) by that angle, so the toolpath lines up with the crooked part.
 * grblHAL has no G68 coordinate rotation, so we do it here before streaming — and
 * the visualizer / tracker parse the same rotated text, so preview + progress match
 * exactly what gets cut.
 *
 * The rotation centre is the program origin (0,0). Because that's the origin, the
 * transform is the plain linear map R(θ):
 *     x' = x·cosθ − y·sinθ ,  y' = x·sinθ + y·cosθ
 * which is identical for absolute points (G90) and incremental deltas (G91) and for
 * arc I/J offset vectors — so no translation bookkeeping is needed, only the modal
 * position (to fill in a coordinate the line leaves implicit).
 *
 * Scope / assumptions (documented, matches typical CAM engraving posts):
 *  · XY plane only (G17). G18/G19 arc planes are passed through untouched.
 *  · G53 (machine coords) and G28/G30 lines are passed through untouched — they
 *    don't live in the rotated work frame.
 *  · R keeps its value (radius is rotation-invariant); the arc ENDPOINT rotates.
 *  · Line count and order are preserved 1:1, so highlight/line indices still match.
 */

const fmt = (v: number): string => {
  const r = Number(v.toFixed(4))
  return Object.is(r, -0) ? '0' : String(r)
}

const WORD = /([A-Za-z])\s*(-?\d*\.?\d+)/g

/** Rotate a G-code program by `deg` degrees about the program origin. deg === 0
 *  (or non-finite) returns the text unchanged. */
export function rotateGcode(text: string, deg: number): string {
  if (!deg || !Number.isFinite(deg)) return text
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  let absMode = true // G90 absolute (vs G91 incremental)
  let motion = -1 // modal motion group: 0/1/2/3, -1 = none seen yet
  let px = 0 // modal program position (pre-rotation), tracked for implicit coords
  let py = 0

  return text
    .split(/\r?\n/)
    .map((line) => rotateLine(line))
    .join('\n')

  function rotateLine(line: string): string {
    // split off a comment tail (';' to EOL, or a '(' block) and leave it untouched
    let code = line
    let comment = ''
    const semi = line.indexOf(';')
    const paren = line.indexOf('(')
    const cut = semi >= 0 && (paren < 0 || semi < paren) ? semi : paren
    if (cut >= 0) {
      code = line.slice(0, cut)
      comment = line.slice(cut)
    }

    // tokenize letter+number words
    const toks: { L: string; raw: string; val: number }[] = []
    let m: RegExpExecArray | null
    WORD.lastIndex = 0
    while ((m = WORD.exec(code))) toks.push({ L: m[1].toUpperCase(), raw: m[0], val: Number(m[2]) })
    if (toks.length === 0) return line

    // update modal state from G words; bail (pass through) on machine-frame moves
    let passthrough = false
    for (const tk of toks) {
      if (tk.L !== 'G') continue
      const g = tk.val
      if (g === 0 || g === 1 || g === 2 || g === 3) motion = g
      else if (g === 90) absMode = true
      else if (g === 91) absMode = false
      else if (g === 53 || g === 28 || g === 30) passthrough = true
    }

    const get = (L: string): number | undefined => toks.find((tk) => tk.L === L)?.val
    const X = get('X')
    const Y = get('Y')
    const I = get('I')
    const J = get('J')
    const hasXY = X !== undefined || Y !== undefined
    const hasIJ = I !== undefined || J !== undefined
    const isMotion = motion === 0 || motion === 1 || motion === 2 || motion === 3

    if (passthrough || !isMotion || (!hasXY && !hasIJ)) {
      // still advance the modal position for a plain move so later implicit coords
      // resolve correctly (only when it's a normal in-frame motion with coords)
      if (!passthrough && isMotion && hasXY) advance(X, Y)
      return line
    }

    const rep: Record<string, string> = {}
    if (hasXY) {
      if (absMode) {
        const nx = X ?? px
        const ny = Y ?? py
        rep.X = 'X' + fmt(nx * cos - ny * sin)
        rep.Y = 'Y' + fmt(nx * sin + ny * cos)
      } else {
        const dx = X ?? 0
        const dy = Y ?? 0
        rep.X = 'X' + fmt(dx * cos - dy * sin)
        rep.Y = 'Y' + fmt(dx * sin + dy * cos)
      }
      advance(X, Y)
    }
    if (hasIJ) {
      const di = I ?? 0
      const dj = J ?? 0
      rep.I = 'I' + fmt(di * cos - dj * sin)
      rep.J = 'J' + fmt(di * sin + dj * cos)
    }

    // rebuild: replace X/Y/I/J in place; append any that rotation newly requires
    // (word order is irrelevant to the interpreter, so appending is safe)
    const used = new Set<string>()
    const pieces = toks.map((tk) => {
      if (rep[tk.L] !== undefined) {
        used.add(tk.L)
        return rep[tk.L]
      }
      return tk.raw
    })
    for (const L of ['X', 'Y', 'I', 'J']) if (rep[L] !== undefined && !used.has(L)) pieces.push(rep[L])

    return pieces.join(' ') + comment
  }

  function advance(X: number | undefined, Y: number | undefined): void {
    if (absMode) {
      if (X !== undefined) px = X
      if (Y !== undefined) py = Y
    } else {
      px += X ?? 0
      py += Y ?? 0
    }
  }
}
