/**
 * Monochrome line icons (Feather-style). Every icon draws with `currentColor`,
 * so it takes the surrounding text colour and flips automatically on hover —
 * matching the Home/Unlock icons in the Jog panel. Size via the `className`
 * prop (defaults to h-4 w-4).
 */
import type { JSX } from 'react'

function Svg({ children, className = 'h-4 w-4' }: { children: React.ReactNode; className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

/** Gear — the Settings tab. */
export function GearIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  )
}

/** Gamepad — the Controls (keyboard/gamepad) category. */
export function ControlsIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <line x1="6" y1="11" x2="10" y2="11" />
      <line x1="8" y1="9" x2="8" y2="13" />
      <line x1="15" y1="12" x2="15.01" y2="12" />
      <line x1="18" y1="10" x2="18.01" y2="10" />
      <path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.6l-.9 9A2 2 0 0 0 3.78 20a3 3 0 0 0 2.56-1.46l.6-1A2 2 0 0 1 8.65 16.6h6.7a2 2 0 0 1 1.71.96l.6 1A3 3 0 0 0 20.22 20a2 2 0 0 0 1.98-2.4l-.9-9A4 4 0 0 0 17.32 5z" />
    </Svg>
  )
}

/** Cube — the Stock (material) category. */
export function StockIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </Svg>
  )
}

/** Crosshair — the Probe category. */
export function ProbeIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </Svg>
  )
}

/** Upload arrow — the Firmware (flash) tab. */
export function UploadIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </Svg>
  )
}

/** Chip — the Board (diagram) tab. */
export function ChipIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </Svg>
  )
}

/** Magnifier — the settings search box. */
export function SearchIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Svg>
  )
}

/** Calculator — the steps/mm calculator. Keypad dots are round-capped
 *  zero-length lines. */
export function CalcIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="8" y1="6" x2="16" y2="6" />
      <line x1="9" y1="12" x2="9" y2="12" />
      <line x1="12" y1="12" x2="12" y2="12" />
      <line x1="15" y1="12" x2="15" y2="12" />
      <line x1="9" y1="15" x2="9" y2="15" />
      <line x1="12" y1="15" x2="12" y2="15" />
      <line x1="15" y1="15" x2="15" y2="15" />
      <line x1="9" y1="18" x2="9" y2="18" />
      <line x1="12" y1="18" x2="12" y2="18" />
      <line x1="15" y1="18" x2="15" y2="18" />
    </Svg>
  )
}

/** Sliders — the tuning dialog. */
export function SlidersIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </Svg>
  )
}

/** List — the "all settings" (advanced) category. */
export function ListIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3" y2="6" />
      <line x1="3" y1="12" x2="3" y2="12" />
      <line x1="3" y1="18" x2="3" y2="18" />
    </Svg>
  )
}

/** Warning triangle — the Errors & alarms category. */
export function AlertIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12" y2="17" />
    </Svg>
  )
}

/** Contrast circle — the Theme category (appearance). */
export function ThemeIcon({ className = 'h-4 w-4' }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** House — homing / limits. */
export function HomeIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </Svg>
  )
}

/** Monitor — a program loaded from the PC. */
export function PcIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </Svg>
  )
}

/** SD card — a program loaded from the controller's SD card. */
export function SdIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <path d="M18 2H8L4 6v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
      <line x1="9" y1="6" x2="9" y2="9" />
      <line x1="12.5" y1="6" x2="12.5" y2="9" />
      <line x1="16" y1="6" x2="16" y2="9" />
    </Svg>
  )
}

/** Document — a single G-code file in the file list. */
export function FileIcon({ className }: { className?: string }): JSX.Element {
  return (
    <Svg className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </Svg>
  )
}

/** Monochrome icon for a settings section, chosen by its id — replaces the
 *  coloured emoji that used to live in machine-config.ts. */
export function SectionIcon({ id, className = 'h-4 w-4' }: { id: string; className?: string }): JSX.Element {
  switch (id) {
    case 'spindle': // rotation
      return (
        <Svg className={className}>
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </Svg>
      )
    case 'motors': // gear / mechanics
      return <GearIcon className={className} />
    case 'homing': // house
      return <HomeIcon className={className} />
    case 'limits': // work-area frame
      return (
        <Svg className={className}>
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
        </Svg>
      )
    case 'inputs': // control switches (toggle)
      return (
        <Svg className={className}>
          <rect x="1" y="5" width="22" height="14" rx="7" />
          <circle cx="16" cy="12" r="3" />
        </Svg>
      )
    case 'probe': // crosshair
      return (
        <Svg className={className}>
          <circle cx="12" cy="12" r="4" />
          <line x1="12" y1="2" x2="12" y2="6" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="2" y1="12" x2="6" y2="12" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </Svg>
      )
    case 'outputs': // power / relays (bolt)
      return (
        <Svg className={className}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </Svg>
      )
    case 'network': // globe
      return (
        <Svg className={className}>
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </Svg>
      )
    case 'pendant': // handheld device
      return (
        <Svg className={className}>
          <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
          <line x1="12" y1="18" x2="12" y2="18" />
        </Svg>
      )
    case 'macros': // script / terminal
      return (
        <Svg className={className}>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </Svg>
      )
    case 'autosquare': // squared gantry — two rails + a cross-member
      return (
        <Svg className={className}>
          <line x1="6" y1="3" x2="6" y2="21" />
          <line x1="18" y1="3" x2="18" y2="21" />
          <rect x="3" y="9" width="18" height="6" rx="1" />
        </Svg>
      )
    default: // behaviour / other — a sparkle
      return (
        <Svg className={className}>
          <path d="M12 3l1.8 6.2 6.2 1.8-6.2 1.8L12 21l-1.8-6.2L4 13l6.2-1.8z" />
        </Svg>
      )
  }
}
