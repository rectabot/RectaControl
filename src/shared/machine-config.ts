/**
 * Friendly machine-setup model: maps painful grblHAL `$` settings (bitmasks,
 * spindle index, on/off flags) onto plain controls — per-axis checkboxes,
 * dropdowns and toggles — so a user can set up a machine without knowing the
 * numbers. Bit i of an axis mask = axis i (X=0, Y=1, Z=2, A=3).
 *
 * All user-visible text (section titles, field labels/descriptions, enum options,
 * bit labels) is stored as an **i18n key** — the renderer resolves it with `t()`.
 * English is the source of truth in shared/i18n/en.ts. `unit` and literal option
 * labels (baud numbers, IP placeholders) stay verbatim and pass through `t()`.
 *
 * The $395 "Default spindle" field carries only a STATIC fallback list here
 * (PWM + Huanyang). At runtime the renderer replaces it with a live picker built
 * from `$SPINDLESH` (SettingsGuided → SpindlePicker), so a fully-loaded firmware
 * lists analog PWM + every compiled Modbus VFD by their real ids/names. The static
 * options are shown only until (or unless) the board answers the enumeration.
 */

export interface EnumOpt {
  value: number
  /** i18n key for the option label. */
  label: string
  /** i18n key for an optional sub-description. */
  desc?: string
}

export type Field =
  /** Whole-value on/off (0/1). */
  | { kind: 'bool'; setting: number; label: string; desc?: string }
  /** A single named bit within a setting, leaving the other bits untouched. */
  | { kind: 'flagBit'; setting: number; bit: number; label: string; desc?: string }
  /** Per-axis bitmask: one checkbox per machine axis (bit i = axis i). */
  | { kind: 'axisMask'; setting: number; label: string; desc?: string }
  /** Bitmask with explicit named bits (e.g. control / coolant pins). */
  | { kind: 'bitFlags'; setting: number; label: string; desc?: string; bits: { bit: number; label: string }[] }
  /** Single-choice index → radio buttons. `columns` lays them out in a grid
   *  (e.g. 3 → two rows of three, with the circles column-aligned). */
  | { kind: 'enum'; setting: number; label: string; desc?: string; options: EnumOpt[]; columns?: number }
  /** Plain numeric setting. */
  | { kind: 'number'; setting: number; label: string; desc?: string; unit?: string }
  /** Per-axis numeric (setting = base + axis index), one input per axis. */
  | { kind: 'axisNumber'; base: number; label: string; desc?: string; unit?: string }
  /** Per-axis jog ± buttons (no setting) — verify a motion direction live. */
  | { kind: 'jogTest'; label: string; desc?: string; distance?: number; feed?: number }
  /** Opens the steps/mm calculator (no setting). */
  | { kind: 'stepsCalc'; label: string; desc?: string }
  /** Opens the dynamic (slider) speed/acceleration tuning window (no setting). */
  | { kind: 'tuneSlider'; label: string; desc?: string }
  /** Free-text setting (hostname, IP address …). */
  | { kind: 'text'; setting: number; label: string; desc?: string; placeholder?: string }
  /** Mach3-style per-axis motor tuning table (steps/mm, rate, accel, travel). */
  | { kind: 'motorTuning' }
  /** Toggles which AUX/coolant output buttons show in the toolpath (UI pref). */
  | { kind: 'auxButtons'; label: string; desc?: string }
  /** App display units mm/inch (not a `$` setting; mirrors the Jog toggle). */
  | { kind: 'displayUnits'; label: string; desc?: string }

/** Logical sections, by function. Every reported `$` setting belongs to exactly
 *  one category, so there are no duplicate groups or settings. */
export type CategoryId =
  | 'spindle'
  | 'motors'
  | 'homing'
  | 'autosquare'
  | 'limits'
  | 'inputs'
  | 'probe'
  | 'outputs'
  | 'network'
  | 'pendant'
  | 'macros'
  | 'behavior'

export interface Section {
  id: CategoryId
  /** i18n key for the section title. */
  title: string
  icon: string
  /** Optional i18n key for a warning/info banner under the section header. */
  note?: string
  /** Curated, friendly controls. Any other reported setting in this category is
   *  appended automatically (smart control by kind) — see settingCategory(). */
  fields: Field[]
}

/** Not shown as a plain generic row. $13 (units) IS visible — but through the
 *  friendly mm/Inch toggle (displayUnits field + header), so it's listed here only
 *  to suppress a duplicate raw "$13=0/1" row. $7 is a deprecated alias of $9.
 *  $519 (encoder spindle) is meaningless without a physical spindle encoder — this
 *  board has none (the VFD reports Hz over Modbus) and the firmware rejects the value. */
export const HIDDEN_SETTINGS = new Set<number>([13, 7, 519])

/** `$` settings that only take effect after a board reset — the UI shows a small
 *  amber note next to these. List from firmware knowledge (network stack, spindle
 *  registration, Modbus/VFD comms, plugin init). 510 is included as the twin of
 *  511 (spindle slot 0/1). */
export const RESET_REQUIRED = new Set<number>([
  16, 70, 300, 301, 302, 303, 304, 305, 307, 308, 374, 395, 398, 481, 510, 511, 520, 535
])

/** Explicit category for `$` numbers below 100 and the 300+ plugin range; the
 *  axis / network / encoder blocks fall through to the ranges in settingCategory. */
const CATEGORY: Record<number, CategoryId> = {
  // Vreteno i laser
  9: 'spindle', 16: 'spindle', 30: 'spindle', 31: 'spindle', 32: 'spindle',
  33: 'spindle', 34: 'spindle', 35: 'spindle', 36: 'spindle', 38: 'spindle',
  340: 'spindle', 374: 'spindle', 375: 'spindle', 392: 'spindle', 393: 'spindle', 394: 'spindle', 395: 'spindle',
  // Motori (stepperi) — $8 (ganged smer invert) ostaje ovde jer je koristan i na
  // klon-buildu (obrni smer Y2 klona), gde auto-square odeljak nije prikazan.
  0: 'motors', 1: 'motors', 2: 'motors', 3: 'motors', 4: 'motors', 8: 'motors', 29: 'motors', 37: 'motors',
  338: 'motors', 339: 'motors', 376: 'motors',
  // Auto-square (ganged osa sa dva prekidača — Y/Y2)
  347: 'autosquare', 348: 'autosquare', 349: 'autosquare',
  // Limiti (prekidači, hard/soft, invert)
  5: 'limits', 18: 'limits', 20: 'limits', 21: 'limits', 40: 'limits',
  // Homing (bazanje)
  22: 'homing', 23: 'homing', 24: 'homing', 25: 'homing', 26: 'homing', 27: 'homing', 43: 'homing',
  // Ulazi (E-stop, vrata, kontrola)
  14: 'inputs', 17: 'inputs', 61: 'inputs', 370: 'inputs', 371: 'inputs',
  // Probe (sonda) — grupisano zasebno radi lakšeg podešavanja
  6: 'probe', 19: 'probe', 65: 'probe',
  // Izlazi (coolant / AUX)
  15: 'outputs', 372: 'outputs', 373: 'outputs',
  378: 'outputs', 379: 'outputs', 380: 'outputs', 381: 'outputs', 382: 'outputs', 383: 'outputs',
  386: 'outputs', 387: 'outputs', 388: 'outputs', 389: 'outputs', 390: 'outputs', 391: 'outputs',
  // Mreža
  396: 'network', 397: 'network',
  // Ponašanje i ostalo
  10: 'behavior', 11: 'behavior', 12: 'behavior', 28: 'behavior', 39: 'behavior', 41: 'behavior', 42: 'behavior',
  60: 'behavior', 62: 'behavior', 63: 'behavior', 64: 'behavior',
  341: 'behavior', 342: 'behavior', 343: 'behavior', 344: 'behavior', 345: 'behavior', 346: 'behavior',
  384: 'behavior', 398: 'behavior', 399: 'behavior',
  // — plugin / extended ($450+) singletons —
  480: 'outputs', 481: 'behavior', 482: 'network', 483: 'outputs', 484: 'inputs', 485: 'behavior', 486: 'behavior',
  487: 'spindle', 488: 'spindle', 489: 'spindle',
  534: 'behavior', 535: 'network', 536: 'outputs', 537: 'outputs', 538: 'motors', 539: 'spindle',
  650: 'behavior', 671: 'homing', 673: 'outputs', 674: 'behavior', 675: 'macros', 676: 'behavior', 677: 'spindle',
  678: 'inputs', 679: 'inputs', 680: 'motors', 681: 'spindle', 682: 'behavior', 700: 'behavior',
  709: 'spindle', 716: 'spindle'
}

/** Which logical section a `$` setting belongs to. */
export function settingCategory(n: number): CategoryId {
  const c = CATEGORY[n]
  if (c) return c
  if (n >= 44 && n <= 49) return 'homing' // homing cycles
  if (n >= 50 && n <= 59) return 'behavior' // jog / parking defaults
  if (n >= 66 && n <= 69) return 'spindle' // piecewise linear spindle PWM
  if (n >= 70 && n <= 79) return 'network' // network services / BT / WiFi
  if (n >= 80 && n <= 96) return 'spindle' // closed-loop / position spindle
  if (n >= 100 && n <= 299) return 'motors' // per-axis settings
  if (n >= 300 && n <= 337) return 'network'
  if (n >= 350 && n <= 369) return 'behavior' // THC (plasma)
  if (n >= 400 && n <= 449) return 'behavior' // encoders
  // — plugin / extended ($450+) ranges —
  if (n >= 460 && n <= 479) return 'spindle' // VFD parameters
  if (n >= 490 && n <= 509) return 'macros' // macros + macro ports
  if (n >= 510 && n <= 527) return 'spindle' // multi-spindle enable / tool start
  if (n >= 530 && n <= 533) return 'network' // MQTT broker
  if (n >= 540 && n <= 579) return 'pendant' // pendant panel
  if (n >= 590 && n <= 599) return 'pendant' // physical button actions
  if (n >= 600 && n <= 639) return 'network' // Modbus TCP
  if (n >= 640 && n <= 649) return 'behavior' // kinematics
  if (n >= 651 && n <= 670) return 'motors' // per-motor (Trinamic)
  if (n >= 730 && n <= 743) return 'spindle' // second spindle
  return 'behavior'
}

/** All `$` numbers handled by an explicit curated control, so they aren't also
 *  appended as a generic row. Axis-indexed settings expand for the axis count. */
export function coveredSettings(axisCount: number): Set<number> {
  const s = new Set<number>(HIDDEN_SETTINGS)
  for (const sec of SECTIONS) {
    for (const f of sec.fields) {
      switch (f.kind) {
        case 'bool':
        case 'flagBit':
        case 'axisMask':
        case 'bitFlags':
        case 'enum':
        case 'number':
        case 'text':
          s.add(f.setting)
          break
        case 'axisNumber':
          for (let i = 0; i < axisCount; i++) s.add(f.base + i)
          break
        case 'motorTuning':
          for (let i = 0; i < axisCount; i++) {
            s.add(100 + i) // steps/mm
            s.add(110 + i) // max rate
            s.add(120 + i) // acceleration
            s.add(130 + i) // max travel
          }
          break
        default:
          break
      }
    }
  }
  return s
}

export const SECTIONS: Section[] = [
  {
    id: 'spindle',
    title: 'sec.spindle.title',
    icon: '🌀',
    fields: [
      {
        kind: 'enum',
        setting: 395,
        label: 'field.395.label',
        desc: 'field.395.desc',
        options: [
          { value: 0, label: 'opt.395.0', desc: 'opt.395.0.desc' },
          { value: 1, label: 'opt.395.1', desc: 'opt.395.1.desc' }
        ]
      },
      { kind: 'number', setting: 30, label: 'field.30.label', unit: 'RPM', desc: 'field.30.desc' },
      { kind: 'number', setting: 31, label: 'field.31.label', unit: 'RPM' },
      {
        kind: 'enum',
        setting: 32,
        label: 'field.32.label',
        desc: 'field.32.desc',
        options: [
          { value: 0, label: 'opt.32.0' },
          { value: 1, label: 'opt.32.1', desc: 'opt.32.1.desc' },
          { value: 2, label: 'opt.32.2' }
        ]
      },
      {
        kind: 'enum',
        setting: 374,
        label: 'field.374.label',
        desc: 'field.374.desc',
        columns: 3,
        options: [
          { value: 0, label: '2400' },
          { value: 1, label: '4800' },
          { value: 2, label: '9600' },
          { value: 3, label: '19200' },
          { value: 4, label: '38400' },
          { value: 5, label: '115200' }
        ]
      },
      {
        kind: 'enum',
        setting: 681,
        label: 'field.681.label',
        desc: 'field.681.desc',
        options: [
          { value: 0, label: 'opt.681.0' },
          { value: 1, label: 'opt.681.1' },
          { value: 2, label: 'opt.681.2' }
        ]
      },
      {
        kind: 'enum',
        setting: 510,
        label: 'field.510.label',
        desc: 'field.510.desc',
        options: [
          { value: 0, label: 'opt.spindleSlot.0' },
          { value: 1, label: 'opt.spindleSlot.1' },
          { value: 2, label: 'opt.spindleSlot.2' }
        ]
      },
      {
        kind: 'enum',
        setting: 511,
        label: 'field.511.label',
        desc: 'field.511.desc',
        options: [
          { value: 0, label: 'opt.spindleSlot.0' },
          { value: 1, label: 'opt.spindleSlot.1' },
          { value: 2, label: 'opt.spindleSlot.2' }
        ]
      }
    ]
  },
  {
    id: 'motors',
    title: 'sec.motors.title',
    icon: '⚙️',
    fields: [
      { kind: 'axisMask', setting: 3, label: 'field.3.label', desc: 'field.3.desc' },
      { kind: 'jogTest', label: 'field.jogtest.label', desc: 'field.jogtest.desc', distance: 5, feed: 1000 },
      { kind: 'stepsCalc', label: 'field.stepscalc.label', desc: 'field.stepscalc.desc' },
      { kind: 'tuneSlider', label: 'field.tune.label', desc: 'field.tune.desc' },
      { kind: 'motorTuning' }
    ]
  },
  {
    id: 'homing',
    title: 'sec.homing.title',
    icon: '🏠',
    fields: [
      {
        kind: 'bitFlags',
        setting: 22,
        label: 'field.22.label',
        desc: 'field.22.desc',
        bits: [
          { bit: 0, label: 'bit.22.0' },
          { bit: 1, label: 'bit.22.1' },
          { bit: 2, label: 'bit.22.2' },
          { bit: 3, label: 'bit.22.3' },
          { bit: 4, label: 'bit.22.4' },
          { bit: 5, label: 'bit.22.5' },
          { bit: 6, label: 'bit.22.6' },
          { bit: 8, label: 'bit.22.8' },
          { bit: 9, label: 'bit.22.9' },
          { bit: 10, label: 'bit.22.10' }
        ]
      },
      { kind: 'axisMask', setting: 23, label: 'field.23.label', desc: 'field.23.desc' },
      { kind: 'number', setting: 27, label: 'field.27.label', unit: 'mm' },
      { kind: 'number', setting: 43, label: 'field.43.label', desc: 'field.43.desc' }
    ]
  },
  {
    // Only shown when the firmware reports $347 (auto-square compiled in) — gated in
    // SettingsBrowser. The three dual-axis settings ($347–$349) + $8 auto-append here.
    id: 'autosquare',
    title: 'sec.autosquare.title',
    icon: '⧉',
    note: 'sec.autosquare.note',
    fields: []
  },
  {
    id: 'limits',
    title: 'sec.limits.title',
    icon: '⛔',
    fields: [
      {
        kind: 'bitFlags',
        setting: 21,
        label: 'field.21.label',
        desc: 'field.21.desc',
        bits: [
          { bit: 0, label: 'bit.21.0' },
          { bit: 1, label: 'bit.21.1' },
          { bit: 2, label: 'bit.21.2' }
        ]
      },
      { kind: 'bool', setting: 20, label: 'field.20.label', desc: 'field.20.desc' },
      { kind: 'axisMask', setting: 5, label: 'field.5.label', desc: 'field.5.desc' }
    ]
  },
  {
    id: 'inputs',
    title: 'sec.inputs.title',
    icon: '🎛️',
    fields: [
      {
        kind: 'bitFlags',
        setting: 14,
        label: 'field.14.label',
        desc: 'field.14.desc',
        bits: [
          { bit: 6, label: 'bit.control.estop' },
          { bit: 2, label: 'bit.control.cyclestart' },
          { bit: 1, label: 'bit.control.feedhold' },
          { bit: 3, label: 'bit.control.door' }
        ]
      },
      {
        kind: 'bitFlags',
        setting: 17,
        label: 'field.17.label',
        desc: 'field.17.desc',
        bits: [
          { bit: 6, label: 'bit.control.estop' },
          { bit: 2, label: 'bit.control.cyclestart' },
          { bit: 1, label: 'bit.control.feedhold' },
          { bit: 3, label: 'bit.control.door' }
        ]
      }
    ]
  },
  {
    id: 'probe',
    title: 'sec.probe.title',
    icon: '⌖',
    fields: [
      { kind: 'bool', setting: 6, label: 'field.6.label', desc: 'field.6.desc' },
      {
        kind: 'bitFlags',
        setting: 65,
        label: 'field.65.label',
        desc: 'field.65.desc',
        // only the bits this board/firmware actually supports — toolsetter,
        // probe 2 and probe-protection (bits 3/4/5) return error:52 here, so we
        // don't expose them.
        bits: [
          { bit: 0, label: 'bit.65.0' },
          { bit: 1, label: 'bit.65.1' }
        ]
      }
      // $19 (probe pull-up disable) auto-appends here if the firmware reports it.
    ]
  },
  {
    id: 'outputs',
    title: 'sec.outputs.title',
    icon: '🔌',
    fields: [
      { kind: 'auxButtons', label: 'field.aux.label', desc: 'field.aux.desc' },
      {
        kind: 'bitFlags',
        setting: 15,
        label: 'field.15.label',
        desc: 'field.15.desc',
        bits: [
          { bit: 0, label: 'bit.15.0' },
          { bit: 1, label: 'bit.15.1' }
        ]
      },
      {
        kind: 'bitFlags',
        setting: 372,
        label: 'field.372.label',
        desc: 'field.372.desc',
        bits: [{ bit: 0, label: 'bit.372.0' }]
      }
    ]
  },
  {
    id: 'network',
    title: 'sec.network.title',
    icon: '🌐',
    note: 'sec.network.note',
    fields: [
      {
        kind: 'enum',
        setting: 301,
        label: 'field.301.label',
        desc: 'field.301.desc',
        options: [
          { value: 0, label: 'opt.301.0' },
          { value: 1, label: 'opt.301.1' },
          { value: 2, label: 'opt.301.2' }
        ]
      },
      { kind: 'text', setting: 302, label: 'field.302.label', placeholder: '192.168.5.1' },
      { kind: 'text', setting: 304, label: 'field.304.label', placeholder: '255.255.255.0' },
      { kind: 'text', setting: 303, label: 'field.303.label', placeholder: '192.168.5.1' },
      { kind: 'text', setting: 300, label: 'field.300.label', placeholder: 'rectabot' },
      { kind: 'number', setting: 305, label: 'field.305.label' }
    ]
  },
  // Both of these are containers for firmware settings that only exist when the
  // matching plugin is compiled in. On a build without it they stay empty, so each
  // carries a note explaining what WOULD live there — an unexplained blank page is
  // the one thing worse than a missing feature.
  {
    id: 'pendant',
    title: 'sec.pendant.title',
    icon: '🕹️',
    note: 'sec.pendant.note',
    fields: []
  },
  {
    id: 'macros',
    title: 'sec.macros.title',
    icon: '📜',
    note: 'sec.macros.note',
    fields: []
  },
  {
    id: 'behavior',
    title: 'sec.behavior.title',
    icon: '✨',
    fields: [
      { kind: 'displayUnits', label: 'field.units.label', desc: 'field.units.desc' },
      {
        kind: 'enum',
        setting: 42,
        label: 'field.42.label',
        desc: 'field.42.desc',
        options: [
          { value: 0, label: 'opt.42.0' },
          { value: 1, label: 'opt.42.1' },
          { value: 2, label: 'opt.42.2' }
        ]
      },
      {
        kind: 'enum',
        setting: 341,
        label: 'field.341.label',
        desc: 'field.341.desc',
        options: [
          { value: 0, label: 'opt.341.0' },
          { value: 1, label: 'opt.341.1' },
          { value: 2, label: 'opt.341.2' },
          { value: 3, label: 'opt.341.3' },
          { value: 4, label: 'opt.341.4' }
        ]
      }
    ]
  }
]

/** "Osnovno" — the short, opinionated set a typical user actually configures to
 *  get a machine running. Everything else lives under the full "Sve" view.
 *  Progressive disclosure: most people never need more than this. */
export const ESSENTIALS: Field[] = [
  { kind: 'displayUnits', label: 'field.units.label', desc: 'field.units.desc.basic' },
  {
    kind: 'enum',
    setting: 395,
    label: 'field.395.label',
    desc: 'field.395.desc',
    options: [
      { value: 0, label: 'opt.395.0', desc: 'opt.395.0.desc' },
      { value: 1, label: 'opt.395.1', desc: 'opt.395.1.desc' }
    ]
  },
  { kind: 'number', setting: 30, label: 'field.30.label', unit: 'RPM', desc: 'field.30.desc' },
  { kind: 'axisMask', setting: 3, label: 'field.3.label', desc: 'field.3.desc' },
  { kind: 'jogTest', label: 'field.jogtest.label', desc: 'field.jogtest.desc', distance: 5, feed: 1000 },
  { kind: 'stepsCalc', label: 'field.stepscalc.label', desc: 'field.stepscalc.desc' },
  { kind: 'tuneSlider', label: 'field.tune.label', desc: 'field.tune.desc' },
  { kind: 'bool', setting: 21, label: 'field.21.label', desc: 'field.21.desc' },
  { kind: 'axisMask', setting: 5, label: 'field.5.label', desc: 'field.5.desc' },
  { kind: 'flagBit', setting: 22, bit: 0, label: 'field.homing.label', desc: 'field.homing.desc' },
  { kind: 'axisMask', setting: 23, label: 'field.23.label', desc: 'field.23.desc' }
]
