import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useStore, rotaryRadius, rotarySweptRadius } from '../store'
import { readDump } from '../readDump'
import { readOffsets } from '../offsets'
import { parseToolpath, usesRotary } from '../toolpath'
import { rotateGcode } from '../gcodeRotate'
import { ViewerControls } from './ViewerControls'
import { panelColor } from '../themeColors'

/** The 3D background for a theme — the recessed surface (bg-panel2) this canvas sits on,
 *  so the viewport is the pane rather than a rectangle laid over it. Also what a spent
 *  rapid is faded TOWARDS, so "barely visible" means the same thing on a dark background
 *  and a light one instead of being a fixed grey that only works on one.
 *
 *  It used to carry its own table, which read bg-base on three themes and bg-panel2 on
 *  dark — so it matched its frame on exactly the theme it was written against, and was a
 *  shade off on the other three. */
const bgColor = panelColor

const GRID_CELL = 10 // mm per square
const LABEL_STEP = 100 // mm between axis dimension labels (100, 200, …)
const DEFAULT_TRAVEL = 300 // mm fallback until $130/$131 are known

type ViewName = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso'

/** A camera-facing text sprite (mm ruler tick). Canvas → texture → Sprite so the
 *  number always reads flat regardless of orbit. Scaled in world (mm) units. */
function makeLabel(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.font = 'bold 40px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 64, 34)
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  // depthTest ON so the toolpath/stock occlude these — they're background orientation
  // ticks, not foreground. depthWrite OFF so they never hide real geometry; low
  // renderOrder + reduced opacity keep them recessed (never fighting the UI chrome).
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0.42,
      depthTest: true,
      depthWrite: false
    })
  )
  spr.renderOrder = -10
  spr.scale.set(24, 12, 1) // ~24 mm wide labels
  return spr
}

/** Build the work-area grid as a rectangle sized to the machine's max travel
 *  ($130 × $131). The origin (0,0) is the front-left corner and the area extends
 *  right (+X) and back (+Y, −worldZ) — the standard convention. The two edges
 *  meeting at the origin are cyan so the home corner is obvious. */
function buildGrid(travel: [number, number, number] | null, light: boolean): THREE.Group {
  const tx = travel && travel[0] > 0 ? travel[0] : DEFAULT_TRAVEL
  const ty = travel && travel[1] > 0 ? travel[1] : DEFAULT_TRAVEL
  const nx = Math.max(1, Math.round(tx / GRID_CELL))
  const ny = Math.max(1, Math.round(ty / GRID_CELL))
  const w = nx * GRID_CELL
  const h = ny * GRID_CELL
  const bx = w // far X edge (right)
  const bz = -h // far Y edge (back = −worldZ)

  const group = new THREE.Group()

  // inner grid lines — kept deliberately faint/neutral so the toolpath and stock
  // read as the foreground and the grid is just a subtle reference.
  // minor lines every GRID_CELL (10 mm); the ones landing on a LABEL_STEP (100 mm)
  // boundary go into a separate "major" buffer drawn stronger, so 100/200/… read as
  // clear reference gridlines (e.g. the 500×500 point) against the faint 10 mm mesh.
  const minor: number[] = []
  const major: number[] = []
  for (let i = 1; i < nx; i++) {
    const x = i * GRID_CELL
    ;(x % LABEL_STEP === 0 ? major : minor).push(x, 0, 0, x, 0, bz)
  }
  for (let j = 1; j < ny; j++) {
    const z = -j * GRID_CELL
    ;((j * GRID_CELL) % LABEL_STEP === 0 ? major : minor).push(0, 0, z, bx, 0, z)
  }
  const minorGeom = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(minor, 3))
  group.add(new THREE.LineSegments(minorGeom, new THREE.LineBasicMaterial({ color: light ? 0xdfe5ec : 0x172230, transparent: true, opacity: light ? 0.7 : 0.55 })))
  if (major.length) {
    const majorGeom = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(major, 3))
    group.add(
      new THREE.LineSegments(
        majorGeom,
        // major 100 mm gridlines — same hue as the far envelope edges, a touch fainter
        new THREE.LineBasicMaterial({ color: light ? 0xaab4c0 : 0x334155, transparent: true, opacity: 0.4 })
      )
    )
  }

  // the two envelope edges that DON'T touch the origin (faint border)
  const far = [bx, 0, 0, bx, 0, bz, 0, 0, bz, bx, 0, bz]
  const farGeom = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(far, 3))
  group.add(new THREE.LineSegments(farGeom, new THREE.LineBasicMaterial({ color: light ? 0xaab4c0 : 0x334155, transparent: true, opacity: 0.7 })))

  // the two edges meeting at the ORIGIN corner, coloured by axis (standard
  // CAD/CNC convention: X = red, Y = green) so the machine axes read at a glance.
  const xEdge = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, bx, 0, 0], 3)
  )
  group.add(new THREE.LineSegments(xEdge, new THREE.LineBasicMaterial({ color: 0xef4444 })))
  const yEdge = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, bz], 3)
  )
  group.add(new THREE.LineSegments(yEdge, new THREE.LineBasicMaterial({ color: 0x22c55e })))

  // mm dimension labels every 100 mm along both origin edges (0 at the corner),
  // so you can read how far into the work envelope any feature sits.
  const labelColor = light ? '#64748b' : '#7c8ba0'
  for (let x = LABEL_STEP; x <= tx + 0.5; x += LABEL_STEP) {
    const spr = makeLabel(String(x), '#ef4444')
    spr.position.set(x, 0, 14) // just in front of the X edge
    group.add(spr)
  }
  for (let y = LABEL_STEP; y <= ty + 0.5; y += LABEL_STEP) {
    const spr = makeLabel(String(y), '#22c55e')
    spr.position.set(-14, 0, -y) // just left of the Y edge
    group.add(spr)
  }
  // origin "0" marker at the corner
  const zero = makeLabel('0', labelColor)
  zero.position.set(-12, 0, 12)
  group.add(zero)

  return group
}

/** Rotary stock, built in CNC-native coords so the parent group's −90° tilt puts
 *  CNC Z up. The workpiece axis runs along the chosen linear axis (X or Y) through
 *  the work origin `o`, extending +axis by `length`. `size` is the diameter (round)
 *  or the cross-section width (square); `sizeH` is its height, which for a
 *  rectangular bar (50 × 60) differs. A bright longitudinal stripe + a front-face
 *  spoke make the live A rotation visible (a bare round bar is radially symmetric;
 *  a square billet also shows its edges). Spun about its axis by the A effect. */
function buildRotaryStock(
  shape: 'round' | 'square',
  size: number,
  sizeH: number,
  length: number,
  axis: 'X' | 'Y'
): THREE.Group {
  const r = size / 2
  const grp = new THREE.Group()

  // build with the length along local Y, radius/section in local X/Z, then rotate the
  // whole geometry onto the X axis for X-mode and push it so the near face sits at
  // the origin (chuck) and it extends +axis by `length`.
  const geo =
    shape === 'round'
      ? new THREE.CylinderGeometry(r, r, length, 48, 1)
      : new THREE.BoxGeometry(size, length, sizeH)
  if (axis === 'X') {
    geo.rotateZ(Math.PI / 2)
    geo.translate(length / 2, 0, 0)
  } else {
    geo.translate(0, length / 2, 0)
  }
  grp.add(
    new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.06, depthWrite: false })
    )
  )
  // Only the outline, kept faint so it recedes behind the toolpath. A large
  // thresholdAngle keeps just the sharp rim edges (the two end caps / box corners)
  // and drops the many shallow facet seams that otherwise clutter a round bar.
  grp.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 30),
      new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.28 })
    )
  )

  // a single faint orientation cue: a stripe along the top (angle 0 = local +Z) so
  // the rotation is readable without the busy wireframe. (Spoke removed — too noisy.)
  // Sits on the top surface, which for a rectangular bar is half its HEIGHT up.
  const top = shape === 'round' ? r : sizeH / 2
  const stripe: number[] = axis === 'X' ? [0, 0, top, length, 0, top] : [0, 0, top, 0, length, top]
  const cueGeom = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute(stripe, 3)
  )
  grp.add(
    new THREE.LineSegments(
      cueGeom,
      new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.35 })
    )
  )

  return grp
}

/** Dispose every geometry/material under a grid group before discarding it. */
function disposeGrid(g: THREE.Group): void {
  g.traverse((o) => {
    if (o instanceof THREE.LineSegments) {
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
    } else if (o instanceof THREE.Sprite) {
      const m = o.material as THREE.SpriteMaterial
      m.map?.dispose()
      m.dispose()
    }
  })
}

/** Static CAD-style ViewCube: a fixed iso cube showing Top / Front / Right, with the
 *  near corner chamfered into a facet that snaps to the 3D (iso) view. `active` (the
 *  canonical view the live camera is aligned with, or null) lights up the matching
 *  zone in cyan; clicking a face/corner snaps the camera there. */
function ViewCube({
  active,
  onPick
}: {
  active: ViewName | null
  onPick: (v: ViewName) => void
}): JSX.Element {
  const CY = '#22d3ee'
  // hexagon + chamfer geometry (viewBox 120×120), see the layout notes in chat
  const P = {
    TOP: '60,14',
    UR: '100,37',
    LR: '100,83',
    BOT: '60,106',
    LL: '20,83',
    UL: '20,37',
    cUL: '42,49.65',
    cUR: '78,49.65',
    cBOT: '60,80.7'
  }
  // label = [text, x, y, rotationDeg] — Front/Right are slanted to sit on the iso face
  // (Front descends to the right +30°, Right rises to the right −30°); Top stays flat
  const faces: { view: ViewName; pts: string; base: string; label?: [string, number, number, number] }[] = [
    { view: 'top', pts: `${P.TOP} ${P.UR} ${P.cUR} ${P.cUL} ${P.UL}`, base: '#3a4a5e', label: ['TOP', 60, 37, 0] },
    { view: 'front', pts: `${P.UL} ${P.LL} ${P.BOT} ${P.cBOT} ${P.cUL}`, base: '#2a3646', label: ['FRONT', 40, 73, 30] },
    { view: 'right', pts: `${P.UR} ${P.cUR} ${P.cBOT} ${P.BOT} ${P.LR}`, base: '#1b2431', label: ['RIGHT', 80, 73, -30] },
    { view: 'iso', pts: `${P.cUL} ${P.cUR} ${P.cBOT}`, base: '#54657a' }
  ]
  const hex = `${P.TOP} ${P.UR} ${P.LR} ${P.BOT} ${P.LL} ${P.UL}`
  return (
    <svg viewBox="0 0 120 120" width={120} height={120} className="drop-shadow">
      {/* outer silhouette */}
      <polygon points={hex} fill="#0b1220" stroke="#0b1220" strokeWidth={2} strokeLinejoin="round" />
      {faces.map((f) => (
        <polygon
          key={f.view}
          points={f.pts}
          onClick={() => onPick(f.view)}
          className="cursor-pointer transition hover:brightness-125"
          fill={active === f.view ? CY : f.base}
          stroke="none"
        />
      ))}
      {/* the three edges that join the faces + the chamfer corner — rounded caps give a
          soft 3D bevel (kept neutral; only the chamfer FACET lights up for 3D) */}
      <path
        d="M 20 37 L 42 49.65 M 100 37 L 78 49.65 M 60 106 L 60 80.7 M 42 49.65 L 78 49.65 L 60 80.7 Z"
        fill="none"
        stroke="#5b6b7f"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
      />
      {faces
        .filter((f) => f.label)
        .map((f) => (
          <text
            key={`${f.view}-l`}
            x={f.label![1]}
            y={f.label![2]}
            transform={`rotate(${f.label![3]} ${f.label![1]} ${f.label![2]})`}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            fontWeight={700}
            pointerEvents="none"
            fill={active === f.view ? '#06212a' : '#cbd5e1'}
          >
            {f.label![0]}
          </text>
        ))}
    </svg>
  )
}

export function Visualizer(): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)
  const rawGcode = useStore((s) => s.gcode)
  const rotationDeg = useStore((s) => s.rotationDeg)
  // draw the ROTATED program when software workpiece-rotation is active, so the
  // 3D preview matches the skewed part exactly like the cut will
  const gcode = useMemo(() => (rawGcode ? rotateGcode(rawGcode, rotationDeg) : rawGcode), [rawGcode, rotationDeg])
  // machine position — the toolpath is drawn in machine coords (WCS offsets
  // applied), so the tool marker follows MPos to stay aligned across G54–G59.
  const mpos = useStore((s) => s.status?.mpos ?? null)
  // job progress (0..1, arc-length machined / total) drives the "already-cut"
  // recolouring so you can see how far along the program the tool has got
  const jobProgress = useStore((s) => s.jobProgress)
  // frozen machined fraction captured at Park: floors the grey colouring so parking
  // (which drops job.running → jobProgress 0) doesn't repaint everything cyan, and
  // the grey survives the resume until the real cut passes the parked point.
  const parkProgress = useStore((s) => s.parkProgress)
  const theme = useStore((s) => s.theme)
  const travel = useStore((s) => s.travel)
  const wcsOffsets = useStore((s) => s.wcsOffsets)
  const wcs = useStore((s) => s.wcs)
  const stock = useStore((s) => s.stock)
  // axis letters ([AXS:n:XYZA…]) — used to find the live A angle for rotary spin
  const axes = useStore((s) => s.info.axes)
  // Does the LOADED program use the A axis? This — not the stock setting — drives the
  // rotary visualization. A rotary program MUST be wrapped onto a cylinder: A has no
  // XY length until wrapped, so an un-wrapped rotary program collapses to a single
  // line. So we wrap/spin/mark whenever the program is rotary, using the stock
  // config's radius/axis (defaults are fine). Enabling the stock is optional — it just
  // refines the diameter and adds the visible cylinder mesh. A flat XY program is
  // never wrapped (fixes a leftover rotary stock breaking an XY program, and here the
  // reverse: a rotary program no longer needs the stock enabled to display).
  const rotaryView = useMemo(() => !!gcode && usesRotary(gcode), [gcode])
  const flatProgram = !!gcode && !rotaryView
  const connected = useStore((s) => s.connected)
  const setSuppressLog = useStore((s) => s.setSuppressLog)
  // `$$`/`$#` are only accepted when Idle (else grblHAL replies error:8). Gate
  // the silent connect-time read on state so a reconnect mid-job never errors.
  const base = useStore((s) => (s.status?.state ?? '').split(':')[0])
  const busy = base === 'Run' || base === 'Jog' || base === 'Hold' || base === 'Home' || base === 'Door'

  // three.js objects kept across renders
  const three = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    group: THREE.Group
    // spins to the live A angle; holds the rotary cylinder + wrapped toolpath so the
    // MATERIAL rotates (the tool marker stays put) — the real 4th-axis behaviour
    rotaryGroup: THREE.Group
    grid: THREE.Group
    line: THREE.LineSegments | null
    // per-segment cumulative path length + originals, so the progress effect can
    // recolour only the machined portion without re-parsing the g-code each tick
    cumLen: Float32Array | null
    totalLen: number
    baseColors: Float32Array | null
    /** per-segment G0 flag — a spent rapid is dimmed differently to a spent cut */
    rapid: Uint8Array | null
    /** the untouched dash coordinates, so a spent rapid's finer dots can be undone */
    baseDists: Float32Array | null
    marker: THREE.ArrowHelper
    axes: THREE.AxesHelper
    stock: THREE.Group | null
    size: number
  } | null>(null)
  // which canonical view the live camera is currently aligned with (null = a custom
  // orbit angle) — drives the static ViewCube highlight
  const [activeView, setActiveView] = useState<ViewName | null>('iso')
  // Follow: when on, the camera pans to keep the live tool position centred (zoom and
  // orientation preserved) — useful on large programs where the tool runs off-screen.
  const [follow, setFollow] = useState(false)
  // the gcode we last framed the camera to — so a WCS/stock tweak rebuilds the
  // geometry WITHOUT snapping the camera back (which threw away the chosen view)
  const framedGcode = useRef<string | null>(null)
  // world-space centre of the toolpath the camera is currently framed on, so a WCS
  // change (which moves the path to another fixture offset) can PAN the camera to
  // follow it without re-orienting or re-zooming
  const framedCenter = useRef<[number, number, number] | null>(null)
  // ViewCube highlight bookkeeping: the camera direction we snapped to (so a real
  // orbit can be told apart from a stray click), a mirror of activeView for the
  // once-bound 'change' handler, and a guard while WE move the camera programmatically
  const snappedDir = useRef<[number, number, number] | null>(null)
  const activeViewRef = useRef<ViewName | null>('iso')
  const snapping = useRef(false)
  activeViewRef.current = activeView

  // Point the camera for a named preset, framed on the CURRENT target/size. Shared by
  // the view buttons and the program-load re-frame so a preset (esp. Top, whose `up`
  // differs) stays correctly oriented instead of ending up rolled/skewed.
  const orientCamera = (v: ViewName): void => {
    const t = three.current
    if (!t) return
    const tg = t.controls.target
    const d = (t.size || 100) * 1.6
    const e = 0.001 // tiny nudge so up-vector never aligns exactly with view dir
    if (v === 'top') {
      t.camera.up.set(0, 0, -1)
      t.camera.position.set(tg.x, tg.y + d, tg.z + e)
    } else if (v === 'bottom') {
      t.camera.up.set(0, 0, 1)
      t.camera.position.set(tg.x, tg.y - d, tg.z + e)
    } else if (v === 'front') {
      t.camera.up.set(0, 1, 0)
      t.camera.position.set(tg.x, tg.y + e, tg.z + d)
    } else if (v === 'back') {
      t.camera.up.set(0, 1, 0)
      t.camera.position.set(tg.x, tg.y + e, tg.z - d)
    } else if (v === 'right') {
      // look down the machine X axis (world X) — the Y-Z side elevation
      t.camera.up.set(0, 1, 0)
      t.camera.position.set(tg.x + d, tg.y + e, tg.z)
    } else if (v === 'left') {
      t.camera.up.set(0, 1, 0)
      t.camera.position.set(tg.x - d, tg.y + e, tg.z)
    } else {
      t.camera.up.set(0, 1, 0)
      t.camera.position.set(tg.x + d, tg.y + d, tg.z + d)
    }
    t.camera.lookAt(tg)
    t.controls.update()
  }

  // --- init scene once ---
  useEffect(() => {
    const mount = mountRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    // From the theme, not from the dark one's value: an effect below repaints this on
    // every theme change, but the first frame is drawn before it runs, and on a light
    // theme that first frame was a dark rectangle where the work should be.
    renderer.setClearColor(bgColor(useStore.getState().theme), 1)
    // …and the same colour on the element itself, so even a frame where the canvas has
    // no content — a lost GPU context, a resize between paints — is the pane's colour
    // rather than the compositor's white.
    renderer.domElement.style.backgroundColor = bgColor(useStore.getState().theme)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 1, 100000)
    camera.position.set(200, 200, 260)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    const grid = buildGrid(useStore.getState().travel, false)
    scene.add(grid)

    // model group: CNC native coords, rotated so CNC Z points up
    const group = new THREE.Group()
    group.rotation.x = -Math.PI / 2
    scene.add(group)

    // rotary sub-group: positioned at the work origin and spun to the live A angle.
    // The cylinder stock + wrapped toolpath are parented here (in axis-local coords)
    // so the MATERIAL turns while the tool marker (in `group`) stays fixed.
    const rotaryGroup = new THREE.Group()
    group.add(rotaryGroup)

    // work-origin axes triad (X=red, Y=green, Z=blue) — positioned at the active
    // work zero in the wcs effect below so it marks the program origin.
    const axes = new THREE.AxesHelper(30)
    group.add(axes)

    // tool marker — red arrow pointing down at the tool position (tip = position)
    const marker = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, 14),
      14,
      0xef4444,
      6,
      4
    )
    group.add(marker)

    three.current = { renderer, scene, camera, controls, group, rotaryGroup, grid, line: null, cumLen: null, totalLen: 0, baseColors: null, rapid: null, baseDists: null, marker, axes, stock: null, size: 100 }

    let raf = 0
    const animate = (): void => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(animate)
    }
    animate()

    // the ViewCube highlight reflects the last clicked view; clear it only when the
    // camera DIRECTION actually deviates (a real orbit), so a stray click that doesn't
    // move the view keeps the highlight. ~3.6° tolerance (dot > 0.998).
    {
      const d0 = new THREE.Vector3().subVectors(camera.position, controls.target).normalize()
      snappedDir.current = [d0.x, d0.y, d0.z]
    }
    const dirTmp = new THREE.Vector3()
    const onControlsChange = (): void => {
      if (snapping.current) return
      const sd = snappedDir.current
      if (!activeViewRef.current || !sd) return
      dirTmp.subVectors(camera.position, controls.target).normalize()
      if (dirTmp.x * sd[0] + dirTmp.y * sd[1] + dirTmp.z * sd[2] < 0.998) {
        snappedDir.current = null
        setActiveView(null)
      }
    }
    controls.addEventListener('change', onControlsChange)

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    })
    ro.observe(mount)

    // Draw once, now, before this frame is composited.
    //
    // The canvas is in the document from the moment it is appended, but the loop above
    // does not draw until the next animation frame — and a canvas that exists with
    // nothing drawn on it composites WHITE. On every reload that was a white rectangle
    // exactly the size of the viewport, on every theme, gone the instant the loop caught
    // up: the same flash whether the app is dark or light, because white is not one of
    // its colours. It is only ever one frame, which is why holding Ctrl+R down hid it —
    // the canvas never got created between reloads.
    renderer.render(scene, camera)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.removeEventListener('change', onControlsChange)
      controls.dispose()
      renderer.dispose()
      // dispose() frees what three.js allocated; the WebGL context itself is the
      // browser's and outlives it until garbage collection gets round to it. A browser
      // keeps only a handful of live contexts and drops the oldest when a new one asks —
      // and a dropped context is a blank canvas. Nothing noticed while the visualizer
      // mounted once a session; it mounts twice per load under StrictMode and again on
      // every reload, which is a fresh reason to hand the context back on the way out.
      renderer.forceContextLoss()
      mount.removeChild(renderer.domElement)
      three.current = null
    }
  }, [])

  // --- rebuild toolpath when gcode changes ---
  useEffect(() => {
    const t = three.current
    if (!t) return
    if (t.line) {
      t.line.removeFromParent()
      t.line.geometry.dispose()
      ;(t.line.material as THREE.Material).dispose()
      t.line = null
    }
    t.cumLen = null
    t.baseColors = null
    t.rapid = null
    t.baseDists = null
    t.totalLen = 0
    if (!gcode) {
      framedGcode.current = null // reloading the same file afterwards should re-frame
      return
    }

    // in rotary mode wrap the program onto the cylinder (A = angle, Z = radial);
    // the axis line is the work origin, matching where the cylinder is drawn
    const rotary = rotaryView
      ? {
          axis: stock.rotaryAxis,
          origin: (wcsOffsets[wcs] ?? [0, 0, 0]) as [number, number, number],
          radius: rotaryRadius(stock)
        }
      : undefined
    const path = parseToolpath(gcode, { offsets: wcsOffsets, wcs, rotary })
    if (!path.hasGeometry) return

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(path.positions, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(path.colors, 3))
    // per-vertex distances make rapids (G0) render dotted while cuts stay solid
    geom.setAttribute('lineDistance', new THREE.BufferAttribute(path.lineDistances, 1))
    const line = new THREE.LineSegments(
      geom,
      new THREE.LineDashedMaterial({ vertexColors: true, dashSize: 1.0, gapSize: 2.0 })
    )
    // rotary geometry is in axis-local coords → parent it in the spinning group so
    // it turns with the cylinder; flat geometry is world coords → parent in `group`
    if (rotary) t.rotaryGroup.add(line)
    else t.group.add(line)
    t.line = line

    // cumulative path length at the END of each 2-vertex segment (mirrors the
    // Tracker's arc-length model, so jobProgress·totalLen picks the same cut point)
    // + a copy of the original colours to restore un-machined / reset segments.
    const p = path.positions
    const segCount = p.length / 6
    const cum = new Float32Array(segCount)
    let total = 0
    for (let i = 0; i < segCount; i++) {
      const o = i * 6
      total += Math.hypot(p[o + 3] - p[o], p[o + 4] - p[o + 1], p[o + 5] - p[o + 2])
      cum[i] = total
    }
    t.cumLen = cum
    t.totalLen = total
    t.baseColors = path.colors.slice()
    t.rapid = path.rapid
    t.baseDists = path.lineDistances.slice()

    // fit camera to bounds — rotary bounds are axis-local, so shift by the work
    // origin (where the rotary group sits) to get the same frame as flat geometry
    const off = rotary ? (wcsOffsets[wcs] ?? [0, 0, 0]) : [0, 0, 0]
    const cx = (path.min[0] + path.max[0]) / 2 + off[0]
    const cy = (path.min[1] + path.max[1]) / 2 + off[1]
    const cz = (path.min[2] + path.max[2]) / 2 + off[2]
    const size = Math.max(
      path.max[0] - path.min[0],
      path.max[1] - path.min[1],
      path.max[2] - path.min[2],
      10
    )
    // group is rotated -90° about X → world target maps (x,y,z)→(x,z,-y)
    t.size = size
    const center: [number, number, number] = [cx, cz, -cy] // world: (x,y,z)→(x,z,-y)
    if (framedGcode.current !== gcode) {
      // new program → re-frame it while KEEPING the current camera orientation (any
      // angle, not just a named preset): same direction + up, distance from size
      framedGcode.current = gcode
      const dir = new THREE.Vector3().subVectors(t.camera.position, t.controls.target)
      if (dir.lengthSq() < 1e-6) dir.set(1, 1, 1)
      dir.normalize().multiplyScalar((t.size || 100) * 1.6)
      t.controls.target.set(center[0], center[1], center[2])
      t.camera.position.set(center[0] + dir.x, center[1] + dir.y, center[2] + dir.z)
      t.controls.update()
    } else if (framedCenter.current) {
      // same program, a WCS/stock change moved the path to another fixture offset →
      // PAN the camera to follow it, keeping the user's orientation AND zoom
      const [px, py, pz] = framedCenter.current
      const dx = center[0] - px
      const dy = center[1] - py
      const dz = center[2] - pz
      if (dx || dy || dz) {
        t.camera.position.set(
          t.camera.position.x + dx,
          t.camera.position.y + dy,
          t.camera.position.z + dz
        )
        t.controls.target.set(
          t.controls.target.x + dx,
          t.controls.target.y + dy,
          t.controls.target.z + dz
        )
        t.controls.update()
      }
    }
    framedCenter.current = center
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gcode, wcsOffsets, wcs, stock])

  // camera view presets — snapped from the static ViewCube faces / corner. Clicking a
  // zone lights it up and records the snapped direction; the highlight stays until the
  // camera direction actually deviates (a real orbit), not on a stray click.
  const applyView = (v: ViewName): void => {
    snapping.current = true // our own camera move — don't let it clear the highlight
    orientCamera(v)
    snapping.current = false
    const t = three.current
    if (t) {
      const d = new THREE.Vector3().subVectors(t.camera.position, t.controls.target).normalize()
      snappedDir.current = [d.x, d.y, d.z]
    }
    setActiveView(v)
  }

  // Fit: re-frame the whole program in the window, KEEPING the current orientation.
  // Cancels Follow (opposite intents: "show everything" vs "stay on the tool").
  const fitView = (): void => {
    const t = three.current
    if (!t || !framedCenter.current) return
    setFollow(false)
    const [cx, cy, cz] = framedCenter.current
    const dir = new THREE.Vector3().subVectors(t.camera.position, t.controls.target)
    if (dir.lengthSq() < 1e-6) dir.set(1, 1, 1)
    dir.normalize().multiplyScalar((t.size || 100) * 1.6)
    t.controls.target.set(cx, cy, cz)
    t.camera.position.set(cx + dir.x, cy + dir.y, cz + dir.z)
    t.controls.update()
  }

  // --- move tool marker with live position ---
  // Flat mode: straight machine coords. Rotary mode: the tool does NOT circle — it
  // stays at the TOP of the cylinder while the material spins under it. So the marker
  // sits at angle 0 (top), at the live along-axis position and the live radial depth.
  useEffect(() => {
    const t = three.current
    if (!t || !mpos) return
    if (rotaryView) {
      const o = wcsOffsets[wcs] ?? [0, 0, 0]
      const radius = rotaryRadius(stock)
      const rho = radius + (mpos[2] - (o[2] ?? 0)) // surface + depth from live Z
      const along = stock.rotaryAxis === 'X' ? mpos[0] : mpos[1]
      const wx = stock.rotaryAxis === 'X' ? along : o[0] ?? 0
      const wy = stock.rotaryAxis === 'X' ? o[1] ?? 0 : along
      const wz = (o[2] ?? 0) + rho // angle 0 → straight up (+Z)
      t.marker.position.set(wx, wy, wz + 14)
    } else {
      // origin is the tail; tip = origin + dir*len lands exactly on the position
      t.marker.position.set(mpos[0], mpos[1], mpos[2] + 14)
    }
    // Follow: pan the camera so the marker stays centred (its real world position
    // accounts for the rotated/spinning group), keeping the user's zoom + orientation.
    if (follow) {
      t.marker.updateWorldMatrix(true, false)
      const wp = t.marker.getWorldPosition(new THREE.Vector3())
      t.camera.position.set(
        t.camera.position.x + (wp.x - t.controls.target.x),
        t.camera.position.y + (wp.y - t.controls.target.y),
        t.camera.position.z + (wp.z - t.controls.target.z)
      )
      t.controls.target.set(wp.x, wp.y, wp.z)
      t.controls.update()
    }
  }, [mpos, stock, axes, wcs, wcsOffsets, rotaryView, follow])

  // --- spin the material (cylinder + wrapped toolpath) to the live A angle ---
  // The rotaryGroup sits at the work origin and turns about the rotary axis. Its spin
  // MUST share the same sign as the wrap angle in wrapPt (both −A here) so the point
  // being cut (material angle = program A ≈ live A) lands at the top under the fixed
  // tool — if the two signs differ the cut drifts at double rate and flips with the A
  // direction. With matched signs the route stays glued to the surface both ways.
  useEffect(() => {
    const t = three.current
    if (!t) return
    const o = wcsOffsets[wcs] ?? [0, 0, 0]
    t.rotaryGroup.position.set(o[0] ?? 0, o[1] ?? 0, o[2] ?? 0)
    t.rotaryGroup.rotation.set(0, 0, 0)
    if (!rotaryView) return
    const iA = axes.indexOf('A')
    const rad = ((iA >= 0 && mpos ? mpos[iA] : 0) * Math.PI) / 180
    if (stock.rotaryAxis === 'X') t.rotaryGroup.rotation.x = -rad
    else t.rotaryGroup.rotation.y = -rad
  }, [mpos, axes, stock, wcs, wcsOffsets, rotaryView])

  // --- recolour the machined portion of the toolpath as the job progresses ---
  // Segments whose cumulative length is within jobProgress·total are dimmed to a
  // neutral grey ("already cut"); the rest keep their bright rapid/cut colours, so
  // the boundary shows how far the tool has got. Runs off jobProgress (updated by
  // the Tracker at ~20 Hz) and resets to full colour when progress returns to 0.
  // How many leading segments are currently painted as "cut". Progress moves this
  // boundary a little at a time, so only the segments it crossed since the last
  // update need touching — repainting all of them 20×/s (and re-uploading the whole
  // colour buffer to the GPU with it) is what made a 4000-line engraving job crawl.
  const dimmedTo = useRef(0)
  const dimTheme = useRef(theme) // which theme the spent segments were painted for
  useEffect(() => {
    dimmedTo.current = 0 // a new program repaints from scratch
  }, [gcode])

  useEffect(() => {
    const t = three.current
    if (!t || !t.line || !t.cumLen || !t.baseColors) return
    const attr = t.line.geometry.getAttribute('color') as THREE.BufferAttribute
    const cols = attr.array as Float32Array
    const base = t.baseColors
    const cum = t.cumLen
    // floor at the parked fraction so the grey holds through Park (jobProgress→0)
    // and the resume return, until the live cut climbs back past the parked point
    const done = Math.max(jobProgress, parkProgress) * t.totalLen

    // cumLen is monotonic, so the boundary is a binary search rather than a scan
    let lo = 0,
      hi = cum.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] <= done) lo = mid + 1
      else hi = mid
    }
    const boundary = lo
    const prev = dimmedTo.current
    // (the "nothing crossed" early-out lives below, after the theme check)

    // A cut the tool has been over goes muted slate — still legible, because where the
    // cutting has got to is the thing being shown.
    const DR = 0.32,
      DG = 0.37,
      DB = 0.44
    // A rapid does not. Travel that has already happened carries no information at all,
    // so it fades almost into the background: the line stays there to be found if you
    // look for it, and stops competing with the program still to come. Fading TOWARDS
    // the background (rather than to a fixed grey) is what makes "barely visible" mean
    // the same thing on the light themes as on the dark ones.
    const FADE = 0.86 // how far towards the background a spent rapid goes
    const bg = new THREE.Color(bgColor(theme))
    const rapid = t.rapid
    const dists = t.line.geometry.getAttribute('lineDistance') as THREE.BufferAttribute
    const dv = dists.array as Float32Array
    const baseDist = t.baseDists

    // …and its dots get finer. A GL line is one pixel wide whatever you ask for, so the
    // only weight a dashed line has is its dot pattern: multiplying the dash coordinate
    // packs the same run into shorter, more frequent dots, which reads as a lighter,
    // thinner line. Uniform per segment, so a run of rapids keeps its pattern continuous.
    const THIN = 2

    const spend = (i: number): void => {
      const o = i * 6
      if (rapid && rapid[i] === 1) {
        for (let v = 0; v < 2; v++) {
          const c = o + v * 3
          cols[c] = base[c] + (bg.r - base[c]) * FADE
          cols[c + 1] = base[c + 1] + (bg.g - base[c + 1]) * FADE
          cols[c + 2] = base[c + 2] + (bg.b - base[c + 2]) * FADE
        }
        if (baseDist) {
          dv[i * 2] = baseDist[i * 2] * THIN
          dv[i * 2 + 1] = baseDist[i * 2 + 1] * THIN
        }
      } else {
        cols[o] = cols[o + 3] = DR
        cols[o + 1] = cols[o + 4] = DG
        cols[o + 2] = cols[o + 5] = DB
      }
    }
    const restore = (i: number): void => {
      const o = i * 6
      for (let k = 0; k < 6; k++) cols[o + k] = base[o + k]
      if (baseDist) {
        dv[i * 2] = baseDist[i * 2]
        dv[i * 2 + 1] = baseDist[i * 2 + 1]
      }
    }

    // A theme switch changes what "faded" is, so everything already spent is repainted
    // in the new one — otherwise the part cut before the switch keeps the old theme's
    // idea of invisible, which on the opposite background is the most visible thing here.
    if (dimTheme.current !== theme) {
      dimTheme.current = theme
      for (let i = 0; i < prev; i++) spend(i)
    } else if (boundary === prev) {
      return // nothing crossed → leave the GPU alone
    }

    if (boundary > prev) for (let i = prev; i < boundary; i++) spend(i)
    // progress went backwards (new job, reset, park unwinding) → restore colour
    else for (let i = boundary; i < prev; i++) restore(i)

    dimmedTo.current = boundary
    attr.needsUpdate = true
    dists.needsUpdate = true
  }, [jobProgress, parkProgress, gcode, theme])

  // --- rebuild the grid on theme / travel change ---
  useEffect(() => {
    const t = three.current
    if (!t) return
    const light = theme === 'light' || theme === 'softlight'
    // 3D background matches the active theme's recessed surface (bg-panel2), which is
    // the pane this canvas sits in
    const clear = bgColor(theme)
    t.renderer.setClearColor(clear, 1)
    t.renderer.domElement.style.backgroundColor = clear
    t.scene.remove(t.grid)
    disposeGrid(t.grid)
    const grid = buildGrid(travel, light)
    // the work-area plane is the surface the workpiece RESTS ON — see gridDrop below
    grid.position.y = (wcsOffsets[wcs]?.[2] ?? 0) - gridDropRef.current
    t.scene.add(grid)
    t.grid = grid
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, travel])

  // How far the work-surface plane sits BELOW the work zero. The grid stands for the
  // table the material rests on, and material always sits ON it — never half sunk
  // through it.
  //   box    — with Z0 on the top face the block spans Z0−thickness…Z0, so the grid
  //            drops by the thickness; with Z0 on the bottom face the two coincide.
  //   rotary — the bar is centred on its axis of rotation, which runs through the work
  //            zero, so it hangs below; drop by its swept radius and it rests tangent
  //            to the plane. For a square/rectangular bar that radius is HALF THE
  //            DIAGONAL, not half a side: the corners are what sweep the widest, and
  //            a bar that could not clear them could not turn at all.
  // With no stock the grid marks the work zero itself, as before. Held in a ref too, so
  // the grid-REBUILD effect (theme/travel) reads the current value without rebuilding
  // the geometry on every keystroke in a dimension box.
  const gridDrop = !stock.enabled
    ? 0
    : stock.mode === 'rotary'
      ? rotarySweptRadius(stock)
      : stock.zOrigin === 'top' ? stock.z : 0
  const gridDropRef = useRef(gridDrop)
  gridDropRef.current = gridDrop

  // --- keep the work-surface plane + origin triad at the active work zero ---
  useEffect(() => {
    const t = three.current
    if (!t) return
    const o = wcsOffsets[wcs] ?? [0, 0, 0]
    t.grid.position.y = (o[2] ?? 0) - gridDrop // world Y = machine Z
    t.axes.position.set(o[0] ?? 0, o[1] ?? 0, o[2] ?? 0) // work origin (machine coords)
  }, [wcs, wcsOffsets, gridDrop])

  // --- stock (material) block: a translucent box at the work origin so you see
  //     the tool cut into the workpiece ---
  useEffect(() => {
    const t = three.current
    if (!t) return
    if (t.stock) {
      t.stock.removeFromParent()
      t.stock.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose()
          ;(o.material as THREE.Material).dispose()
        }
      })
      t.stock = null
    }
    if (!stock.enabled) return
    const o = wcsOffsets[wcs] ?? [0, 0, 0]

    if (stock.mode === 'rotary') {
      // a flat XY program is loaded → don't float a cylinder around it (still shows
      // with no program, as a stock preview, or with a genuine rotary program)
      if (flatProgram) return
      const size = stock.rotaryShape === 'round' ? stock.diameter : stock.side
      const sizeH = stock.rotaryShape === 'round' ? stock.diameter : stock.sideH
      if (size <= 0 || sizeH <= 0 || stock.length <= 0) return
      // built in axis-local coords → parented in the spinning rotaryGroup
      const grp = buildRotaryStock(stock.rotaryShape, size, sizeH, stock.length, stock.rotaryAxis)
      t.rotaryGroup.add(grp)
      t.stock = grp
      return
    }

    if (stock.x <= 0 || stock.y <= 0 || stock.z <= 0) return
    // Z0 is on the top or bottom face → the box spans below (top origin) or above.
    const zLo = stock.zOrigin === 'top' ? -stock.z : 0
    // …and in XY it hangs off whichever corner the CAM job zeroed on, or straddles the
    // origin for a centre zero. Machine convention: +X right, +Y away — so a "front"
    // corner puts the block on the +Y side, a "right" corner on the −X side.
    const c = stock.originCorner
    const cx = c === 'FR' || c === 'BR' ? -stock.x / 2 : c === 'C' ? 0 : stock.x / 2
    const cy = c === 'BL' || c === 'BR' ? -stock.y / 2 : c === 'C' ? 0 : stock.y / 2
    const box = new THREE.BoxGeometry(stock.x, stock.y, stock.z)
    // BoxGeometry is centred → shift so the chosen origin lands at the work zero
    box.translate((o[0] ?? 0) + cx, (o[1] ?? 0) + cy, (o[2] ?? 0) + zLo + stock.z / 2)
    const grp = new THREE.Group()
    grp.add(
      new THREE.Mesh(
        box,
        new THREE.MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.12, depthWrite: false })
      )
    )
    grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x94a3b8 })))
    t.group.add(grp)
    t.stock = grp
  }, [stock, wcs, wcsOffsets, flatProgram])


  // --- on connect, silently read max travel ($$) and WCS offsets ($#) so the
  //     grid is sized and multi-fixture toolpaths land at their real positions.
  //     Waits until Idle (both are idle-only commands) and reads once per
  //     connection — so a reconnect mid-job defers instead of throwing error:8. ---
  const didConnectRead = useRef(false)
  useEffect(() => {
    if (!connected) {
      didConnectRead.current = false
      return
    }
    if (busy || didConnectRead.current) return
    didConnectRead.current = true
    // Both go through the shared readers, because somebody else wants exactly these
    // lines at exactly this moment: the Settings panel reads `$$`, and App reads the
    // offsets. Neither reply is ours alone — they land in the store, which is where
    // this component takes them from — so the only thing worth owning is that they
    // happen. Asking separately put a second `$$` (116 lines) and a second `$#` (15)
    // on the wire on every connect.
    void readOffsets({ maxAgeMs: 1500 })
    void readDump({ quiet: true })
  }, [connected, busy, setSuppressLog])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-panel2">
      <div ref={mountRef} className="h-full w-full" />

      {/* static CAD-style ViewCube (top-right) */}
      <div className="absolute right-2 top-1">
        <ViewCube active={activeView} onPick={applyView} />
      </div>

      {/* Fit / Follow, top row (level with Load), just left of the cube */}
      <div className="absolute flex items-center gap-2" style={{ top: 8, right: 132 }}>
        {/* Fit: frame the whole program now */}
        <button
          onClick={fitView}
          title="Fit the whole program in view"
          className="rounded-md border border-border bg-panel/80 px-3 py-1 font-mono text-xs text-slate-400 backdrop-blur transition hover:text-slate-200"
        >
          Fit
        </button>
        {/* Follow: keep the tool centred while it runs */}
        <button
          onClick={() => setFollow((f) => !f)}
          title="Keep the camera on the moving tool"
          className={`rounded-md border px-3 py-1 font-mono text-xs backdrop-blur transition ${
            follow
              ? 'border-brand bg-brand text-base'
              : 'border-border bg-panel/80 text-slate-400 hover:text-slate-200'
          }`}
        >
          Follow
        </button>
      </div>

      <ViewerControls />
    </div>
  )
}
