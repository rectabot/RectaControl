import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useStore } from '../store'
import { parseToolpath, usesRotary } from '../toolpath'
import { rotateGcode } from '../gcodeRotate'
import { ViewerControls } from './ViewerControls'

const GRID_CELL = 10 // mm per square
const LABEL_STEP = 100 // mm between axis dimension labels (100, 200, …)
const DEFAULT_TRAVEL = 300 // mm fallback until $130/$131 are known

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
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
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
  const inner: number[] = []
  for (let i = 1; i < nx; i++) {
    const x = i * GRID_CELL
    inner.push(x, 0, 0, x, 0, bz)
  }
  for (let j = 1; j < ny; j++) {
    const z = -j * GRID_CELL
    inner.push(0, 0, z, bx, 0, z)
  }
  const innerGeom = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(inner, 3))
  group.add(new THREE.LineSegments(innerGeom, new THREE.LineBasicMaterial({ color: light ? 0xdfe5ec : 0x172230, transparent: true, opacity: light ? 0.7 : 0.55 })))

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
 *  or the across-flats side (square). A bright longitudinal stripe + a front-face
 *  spoke make the live A rotation visible (a bare round bar is radially symmetric;
 *  a square billet also shows its edges). Spun about its axis by the A effect. */
function buildRotaryStock(
  shape: 'round' | 'square',
  size: number,
  length: number,
  axis: 'X' | 'Y'
): THREE.Group {
  const r = size / 2
  const grp = new THREE.Group()

  // build with the length along local Y, radius/side in local X/Z, then rotate the
  // whole geometry onto the X axis for X-mode and push it so the near face sits at
  // the origin (chuck) and it extends +axis by `length`.
  const geo =
    shape === 'round'
      ? new THREE.CylinderGeometry(r, r, length, 48, 1)
      : new THREE.BoxGeometry(size, length, size)
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
  const stripe: number[] = axis === 'X' ? [0, 0, r, length, 0, r] : [0, 0, r, 0, length, r]
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
    marker: THREE.ArrowHelper
    axes: THREE.AxesHelper
    stock: THREE.Group | null
    size: number
  } | null>(null)
  const [view, setView] = useState<'top' | 'front' | 'iso'>('iso')

  // --- init scene once ---
  useEffect(() => {
    const mount = mountRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setClearColor(0x0a1421, 1)
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

    three.current = { renderer, scene, camera, controls, group, rotaryGroup, grid, line: null, cumLen: null, totalLen: 0, baseColors: null, marker, axes, stock: null, size: 100 }

    let raf = 0
    const animate = (): void => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(animate)
    }
    animate()

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    })
    ro.observe(mount)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
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
    t.totalLen = 0
    if (!gcode) return

    // in rotary mode wrap the program onto the cylinder (A = angle, Z = radial);
    // the axis line is the work origin, matching where the cylinder is drawn
    const rotary = rotaryView
      ? {
          axis: stock.rotaryAxis,
          origin: (wcsOffsets[wcs] ?? [0, 0, 0]) as [number, number, number],
          radius: (stock.rotaryShape === 'round' ? stock.diameter : stock.side) / 2
        }
      : undefined
    const path = parseToolpath(gcode, { offsets: wcsOffsets, wcs, rotary })
    if (!path.hasGeometry) return

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(path.positions, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(path.colors, 3))
    const line = new THREE.LineSegments(
      geom,
      new THREE.LineBasicMaterial({ vertexColors: true })
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
    t.controls.target.set(cx, cz, -cy)
    t.camera.position.set(cx + size, cz + size, -cy + size * 1.3)
    t.controls.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gcode, wcsOffsets, wcs, stock])

  // camera view presets (Top / Front / 3D)
  const applyView = (v: 'top' | 'front' | 'iso'): void => {
    setView(v)
    const t = three.current
    if (!t) return
    const tg = t.controls.target
    const d = (t.size || 100) * 1.6
    if (v === 'top') {
      t.camera.up.set(0, 0, -1)
      t.camera.position.set(tg.x, tg.y + d, tg.z + 0.001)
    } else if (v === 'front') {
      t.camera.up.set(0, 1, 0)
      t.camera.position.set(tg.x, tg.y + 0.001, tg.z + d)
    } else {
      t.camera.up.set(0, 1, 0)
      t.camera.position.set(tg.x + d, tg.y + d, tg.z + d)
    }
    t.camera.lookAt(tg)
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
      const radius = (stock.rotaryShape === 'round' ? stock.diameter : stock.side) / 2
      const rho = radius + (mpos[2] - (o[2] ?? 0)) // surface + depth from live Z
      const along = stock.rotaryAxis === 'X' ? mpos[0] : mpos[1]
      const wx = stock.rotaryAxis === 'X' ? along : o[0] ?? 0
      const wy = stock.rotaryAxis === 'X' ? o[1] ?? 0 : along
      const wz = (o[2] ?? 0) + rho // angle 0 → straight up (+Z)
      t.marker.position.set(wx, wy, wz + 14)
      return
    }
    // origin is the tail; tip = origin + dir*len lands exactly on the position
    t.marker.position.set(mpos[0], mpos[1], mpos[2] + 14)
  }, [mpos, stock, axes, wcs, wcsOffsets, rotaryView])

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
  useEffect(() => {
    const t = three.current
    if (!t || !t.line || !t.cumLen || !t.baseColors) return
    const attr = t.line.geometry.getAttribute('color') as THREE.BufferAttribute
    const cols = attr.array as Float32Array
    const base = t.baseColors
    // floor at the parked fraction so the grey holds through Park (jobProgress→0)
    // and the resume return, until the live cut climbs back past the parked point
    const done = Math.max(jobProgress, parkProgress) * t.totalLen
    // muted slate — reads as "spent" against both dark and light backgrounds
    const DR = 0.32,
      DG = 0.37,
      DB = 0.44
    for (let i = 0; i < t.cumLen.length; i++) {
      const o = i * 6
      if (t.cumLen[i] <= done) {
        cols[o] = cols[o + 3] = DR
        cols[o + 1] = cols[o + 4] = DG
        cols[o + 2] = cols[o + 5] = DB
      } else {
        cols[o] = base[o]
        cols[o + 1] = base[o + 1]
        cols[o + 2] = base[o + 2]
        cols[o + 3] = base[o + 3]
        cols[o + 4] = base[o + 4]
        cols[o + 5] = base[o + 5]
      }
    }
    attr.needsUpdate = true
  }, [jobProgress, parkProgress, gcode])

  // --- rebuild the grid on theme / travel change ---
  useEffect(() => {
    const t = three.current
    if (!t) return
    const light = theme === 'light' || theme === 'softlight'
    // 3D background matches the active theme's recessed surface (bg-base)
    const clear =
      theme === 'light' ? 0xe2e8f0 : theme === 'softlight' ? 0xdde2ea : theme === 'violet' ? 0x100c1c : 0x0a1421
    t.renderer.setClearColor(clear, 1)
    t.scene.remove(t.grid)
    disposeGrid(t.grid)
    const grid = buildGrid(travel, light)
    // sit the work-area plane at the active work zero's height (machine Z of the
    // WCS Z origin), so it represents the STOCK TOP (Z0) — the toolpath then rests
    // on the surface instead of floating below the machine top (world Y = machine Z).
    grid.position.y = wcsOffsets[wcs]?.[2] ?? 0
    t.scene.add(grid)
    t.grid = grid
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, travel])

  // --- keep the work-surface plane + origin triad at the active work zero ---
  useEffect(() => {
    const t = three.current
    if (!t) return
    const o = wcsOffsets[wcs] ?? [0, 0, 0]
    t.grid.position.y = o[2] ?? 0 // world Y = machine Z
    t.axes.position.set(o[0] ?? 0, o[1] ?? 0, o[2] ?? 0) // work origin (machine coords)
  }, [wcs, wcsOffsets])

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
      if (size <= 0 || stock.length <= 0) return
      // built in axis-local coords → parented in the spinning rotaryGroup
      const grp = buildRotaryStock(stock.rotaryShape, size, stock.length, stock.rotaryAxis)
      t.rotaryGroup.add(grp)
      t.stock = grp
      return
    }

    if (stock.x <= 0 || stock.y <= 0 || stock.z <= 0) return
    // stock sits with its front-left-bottom at the work origin XY; Z0 is on the
    // top or bottom face → the box spans below (top origin) or above (bottom).
    const zLo = stock.zOrigin === 'top' ? -stock.z : 0
    const box = new THREE.BoxGeometry(stock.x, stock.y, stock.z)
    // BoxGeometry is centred → shift so a corner sits at the work origin
    box.translate((o[0] ?? 0) + stock.x / 2, (o[1] ?? 0) + stock.y / 2, (o[2] ?? 0) + zLo + stock.z / 2)
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
    let off: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout>
    let done = false
    let oks = 0
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      off?.()
      setSuppressLog(false)
    }
    setSuppressLog(true)
    off = window.recta.onEvent((e) => {
      if (e.type === 'line' && e.data.trim() === 'ok' && ++oks >= 2) finish()
    })
    timer = setTimeout(finish, 3000)
    window.recta.send('$#')
    window.recta.send('$$')
    return finish
  }, [connected, busy, setSuppressLog])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-panel2">
      <div ref={mountRef} className="h-full w-full" />

      {/* view preset tabs */}
      <div className="absolute right-3 top-2 flex overflow-hidden rounded-md border border-border bg-panel/80 backdrop-blur">
        {(
          [
            ['top', 'Top'],
            ['front', 'Front'],
            ['iso', '3D']
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => applyView(v)}
            className={`px-3 py-1 font-mono text-xs transition ${
              view === v ? 'bg-brand text-base' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ViewerControls />
    </div>
  )
}
