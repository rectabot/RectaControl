/**
 * Human-readable names/descriptions for grblHAL `$` settings, so the browser shows
 * "$110 — X max rate (mm/min)" instead of a bare number. English is the canonical
 * source (SETTING_NAMES / SETTING_DESC / MASK_BITS); Serbian override maps
 * (*_SR) translate the common ones and fall back to English for the rest.
 */
import type { Lang } from './i18n'

export const SETTING_NAMES: Record<number, string> = {
  0: 'Step pulse time (µs)',
  1: 'Step idle delay (ms)',
  2: 'Step pulse invert (mask)',
  3: 'Step direction invert (mask)',
  4: 'Invert step enable pin(s) (mask)',
  5: 'Invert limit pins (mask)',
  6: 'Invert probe pin',
  8: 'Ganged axes direction invert (mask)',
  9: 'PWM spindle options (mask)',
  10: 'Status report options (mask)',
  11: 'Junction deviation (mm)',
  12: 'Arc tolerance (mm)',
  13: 'Report in inches',
  14: 'Invert control pins (mask)',
  15: 'Invert coolant pins (mask)',
  16: 'Invert spindle enable/dir (mask)',
  17: 'Pullup disable control pins (mask)',
  18: 'Pullup disable limit pins (mask)',
  19: 'Pullup disable probe pin',
  20: 'Soft limits enable',
  21: 'Hard limits enable',
  22: 'Homing cycle enable (mask)',
  23: 'Homing direction invert (mask)',
  24: 'Homing locate feed rate (mm/min)',
  25: 'Homing search seek rate (mm/min)',
  26: 'Homing switch debounce (ms)',
  27: 'Homing switch pull-off (mm)',
  28: 'G73 retract distance (mm)',
  29: 'Step pulse delay (µs)',
  30: 'Maximum spindle speed (RPM)',
  31: 'Minimum spindle speed (RPM)',
  32: 'Laser-mode enable',
  33: 'Spindle PWM frequency (Hz)',
  34: 'Spindle PWM off value (%)',
  35: 'Spindle PWM min value (%)',
  36: 'Spindle PWM max value (%)',
  37: 'Steppers to keep enabled (mask)',
  38: 'Spindle encoder pulses/rev',
  39: 'Enable printable realtime chars',
  40: 'Soft limits for jog',
  43: 'Homing passes',
  44: 'Homing cycle 1 (mask)',
  45: 'Homing cycle 2 (mask)',
  46: 'Homing cycle 3 (mask)',
  62: 'Sleep enable',
  63: 'Feed hold actions',
  64: 'Force init alarm',
  70: 'Network services (mask)',
  100: 'X steps/mm',
  101: 'Y steps/mm',
  102: 'Z steps/mm',
  103: 'A steps/mm',
  110: 'X max rate (mm/min)',
  111: 'Y max rate (mm/min)',
  112: 'Z max rate (mm/min)',
  113: 'A max rate (mm/min)',
  120: 'X acceleration (mm/s²)',
  121: 'Y acceleration (mm/s²)',
  122: 'Z acceleration (mm/s²)',
  123: 'A acceleration (mm/s²)',
  130: 'X max travel (mm)',
  131: 'Y max travel (mm)',
  132: 'Z max travel (mm)',
  133: 'A max travel (mm)',
  300: 'Hostname',
  301: 'IP mode (0=static,1=DHCP)',
  302: 'IP address',
  303: 'Gateway',
  304: 'Netmask',
  305: 'Telnet port',
  306: 'HTTP port',
  307: 'Websocket port',
  340: 'Spindle at speed tolerance (%)',
  374: 'Modbus baud rate (index)',
  395: 'Default spindle',
  // — extended coverage (numbers from Firmware/grbl/settings.h) —
  7: 'Spindle PWM behaviour (deprecated)',
  41: 'Parking enable',
  42: 'Parking axis',
  47: 'Homing cycle 4 (mask)',
  48: 'Homing cycle 5 (mask)',
  49: 'Homing cycle 6 (mask)',
  50: 'Jog step speed (mm/min)',
  51: 'Jog slow speed (mm/min)',
  52: 'Jog fast speed (mm/min)',
  53: 'Jog step distance (mm)',
  54: 'Jog slow distance (mm)',
  55: 'Jog fast distance (mm)',
  56: 'Parking pull-out increment (mm)',
  57: 'Parking pull-out rate (mm/min)',
  58: 'Parking target (mm)',
  59: 'Parking fast rate (mm/min)',
  60: 'Restore overrides on reset',
  61: 'Safety door options (mask)',
  65: 'Probing options (mask)',
  104: 'B steps/mm',
  114: 'B max rate (mm/min)',
  124: 'B acceleration (mm/s²)',
  134: 'B max travel (mm)',
  308: 'FTP port',
  341: 'Tool change mode',
  342: 'Tool change probing distance (mm)',
  343: 'Tool change locate feed rate (mm/min)',
  344: 'Tool change search seek rate (mm/min)',
  345: 'Tool change probe pull-off rate (mm/min)',
  346: 'Tool change options (mask)',
  347: 'Dual-axis length fail (%)',
  348: 'Dual-axis length fail min (mm)',
  349: 'Dual-axis length fail max (mm)',
  370: 'Invert aux input pins (mask)',
  371: 'Disable aux input pullups (mask)',
  372: 'Invert aux output pins (mask)',
  373: 'Aux output open-drain (mask)',
  375: 'Modbus RX timeout (ms)',
  376: 'Rotary axes (mask)',
  384: 'Disable G92 persistence',
  392: 'Door spindle on delay (s)',
  393: 'Door coolant on delay (s)',
  394: 'Spindle on delay (s)',
  396: 'WebUI timeout (min)',
  398: 'Planner buffer blocks',
  399: 'CAN bus baud rate',
  // — plugin / extended ($450+) singletons —
  460: 'VFD Modbus address',
  461: 'VFD RPM ↔ Hz factor',
  480: 'Fan 0 off delay (s)',
  481: 'Auto-report interval (ms)',
  482: 'Timezone offset (h)',
  483: 'Fan ↔ spindle link',
  484: 'Unlock after E-stop',
  485: 'Tool number persistence',
  486: 'Lock coordinate systems',
  487: 'Spindle enable port',
  488: 'Spindle direction port',
  489: 'Spindle PWM port',
  519: 'Encoder spindle',
  530: 'MQTT broker IP',
  531: 'MQTT broker port',
  532: 'MQTT username',
  533: 'MQTT password',
  534: 'NGC debug output',
  535: 'Network MAC',
  536: 'RGB strip 0 length',
  537: 'RGB strip 1 length',
  538: 'Rotary axes wrap',
  539: 'Spindle off delay (s)',
  540: 'Pendant: spindle speed',
  541: 'Pendant: Modbus address',
  542: 'Pendant: update interval (ms)',
  543: 'Pendant: jog speed ×1',
  544: 'Pendant: jog speed ×10',
  545: 'Pendant: jog speed ×100',
  546: 'Pendant: jog speed (keypad)',
  547: 'Pendant: jog step ×1 (mm)',
  548: 'Pendant: jog step ×10 (mm)',
  549: 'Pendant: jog step ×100 (mm)',
  550: 'Pendant: jog step keypad (mm)',
  551: 'Pendant: jog accel ramp',
  552: 'Pendant: encoder 0 mode',
  553: 'Pendant: encoder 0 counts/detent',
  554: 'Pendant: encoder 1 mode',
  555: 'Pendant: encoder 1 counts/detent',
  556: 'Pendant: encoder 2 mode',
  557: 'Pendant: encoder 2 counts/detent',
  558: 'Pendant: encoder 3 mode',
  559: 'Pendant: encoder 3 counts/detent',
  650: 'Filesystem options',
  671: 'Home pins invert (mask)',
  673: 'Coolant on delay (s)',
  674: 'THC options (mask)',
  675: 'Macro ATC options (mask)',
  676: 'Reset actions (mask)',
  677: 'Stepper-spindle options (mask)',
  678: 'Toolsetter relay port',
  679: 'Probe 2 relay port',
  680: 'Stepper enable delay (ms)',
  681: 'Modbus stream format',
  682: 'THC feed factor',
  700: 'Subroutine options (mask)',
  // second spindle ($709–$743)
  709: 'Spindle 2 PWM options (mask)',
  716: 'Spindle 2 invert (mask)',
  730: 'Spindle 2 max speed (RPM)',
  731: 'Spindle 2 min speed (RPM)',
  732: 'Spindle 2 laser mode',
  733: 'Spindle 2 PWM frequency (Hz)',
  734: 'Spindle 2 PWM off (%)',
  735: 'Spindle 2 PWM min (%)',
  736: 'Spindle 2 PWM max (%)',
  742: 'Motor warnings enable (mask)',
  743: 'Motor warnings invert (mask)'
}

// Repeated families — generated so the map stays readable.
for (let i = 0; i < 10; i++) {
  SETTING_NAMES[490 + i] = `Macro ${i}`
  SETTING_NAMES[500 + i] = `Macro ${i} — port`
  SETTING_NAMES[590 + i] = `Button ${i} — action`
  SETTING_NAMES[640 + i] = `Kinematics ${i}`
}
for (let i = 0; i < 8; i++) {
  SETTING_NAMES[510 + i] = `Spindle ${i} — enable`
  SETTING_NAMES[520 + i] = `Spindle ${i} — tool start`
}
for (let i = 462; i <= 479; i++) if (!(i in SETTING_NAMES)) SETTING_NAMES[i] = `VFD parameter (${i})`
for (let i = 600; i <= 639; i++) SETTING_NAMES[i] = `Modbus TCP (${i})`
for (let i = 651; i <= 670; i++) SETTING_NAMES[i] = `Motor driver ${i - 650}`

/** Serbian name overrides for the settings a domestic user is most likely to see
 *  as a generic row. Anything not listed falls back to the English name. */
const SETTING_NAMES_SR: Record<number, string> = {
  10: 'Opcije status izveštaja (maska)',
  11: 'Junction deviation (mm)',
  12: 'Tolerancija luka (mm)',
  24: 'Homing — spora brzina (mm/min)',
  25: 'Homing — brza brzina (mm/min)',
  26: 'Homing — debounce prekidača (ms)',
  40: 'Soft limiti za jog',
  60: 'Vrati override-e na reset',
  61: 'Opcije sigurnosnih vrata (maska)',
  65: 'Opcije probe-a (maska)',
  300: 'Ime uređaja (hostname)',
  306: 'HTTP port',
  307: 'Websocket port',
  308: 'FTP port',
  340: 'Tolerancija „vreteno na brzini" (%)',
  346: 'Opcije promene alata (maska)',
  347: 'Dozvoljena razlika dužine osa (%)',
  376: 'Rotacione ose (maska)',
  392: 'Vrata — kašnjenje vretena (s)',
  393: 'Vrata — kašnjenje coolant-a (s)',
  394: 'Kašnjenje uključenja vretena (s)',
  398: 'Blokovi u planeru',
  460: 'VFD Modbus adresa',
  461: 'VFD RPM ↔ Hz faktor',
  480: 'Ventilator 0 — kašnjenje gašenja (s)',
  481: 'Interval auto-izveštaja (ms)',
  486: 'Zaključaj koordinatne sisteme',
  539: 'Kašnjenje gašenja vretena (s)',
  650: 'Opcije fajl sistema',
  673: 'Kašnjenje uključenja coolant-a (s)',
  680: 'Kašnjenje enable-a stepera (ms)'
}

export function settingName(n: number, lang: Lang = 'en'): string {
  return (lang === 'sr' && SETTING_NAMES_SR[n]) || SETTING_NAMES[n] || `Setting $${n}`
}

/** Short plain-language descriptions (English source) to help configure the machine. */
export const SETTING_DESC: Record<number, string> = {
  0: 'Step pulse duration in microseconds (usually 10).',
  1: 'How long drivers stay energized after stopping, in ms (255 = always on).',
  2: 'Bitmask: invert the step pulse per axis.',
  3: 'Bitmask: invert direction per axis (if an axis moves the wrong way).',
  4: 'Invert the driver enable pin (if drivers work inverted).',
  5: 'Bitmask: invert the limit switches (NC vs NO wiring).',
  6: 'Invert the probe input (if it triggers inverted).',
  10: 'What the status report contains (MPos/WPos, buffer…).',
  11: 'Junction deviation — corner rounding (mm). Lower = sharper/slower.',
  12: 'Arc tolerance — arc accuracy (mm). Lower = smoother arc.',
  13: 'Report position in inches (0 = mm, 1 = inch).',
  20: 'Soft limits — stop before leaving the work envelope (requires homing).',
  21: 'Hard limits — stop on the physical limit switches.',
  22: 'Enable the homing cycle (limit switches required).',
  23: 'Bitmask: homing direction per axis (which end it goes to).',
  24: 'Slow feed rate for accurately locating zero (mm/min).',
  25: 'Fast rate for finding the limit during homing (mm/min).',
  26: 'Limit-switch debounce (ms), against false triggers.',
  27: 'Pull-off — how far it retracts from the limit after homing (mm).',
  30: 'Maximum spindle speed (RPM) — corresponds to 10 V / S-max.',
  31: 'Minimum spindle speed (RPM).',
  32: 'Laser mode — continuous motion with PWM (for laser/CO₂).',
  100: 'Steps per mm for the X axis (X calibration).',
  101: 'Steps per mm for the Y axis (Y calibration).',
  102: 'Steps per mm for the Z axis (Z calibration).',
  110: 'Maximum rate of the X axis (mm/min).',
  111: 'Maximum rate of the Y axis (mm/min).',
  112: 'Maximum rate of the Z axis (mm/min).',
  120: 'X-axis acceleration (mm/s²). Higher = faster start/stop, risk of lost steps.',
  121: 'Y-axis acceleration (mm/s²).',
  122: 'Z-axis acceleration (mm/s²).',
  130: 'Maximum X-axis travel (mm) — for soft limits.',
  131: 'Maximum Y-axis travel (mm).',
  132: 'Maximum Z-axis travel (mm).',
  70: 'Network services bitmask (telnet/websocket/http).',
  374: 'Modbus communication speed index.',
  395: 'Default spindle at startup (PWM / Modbus).',
  // — extended coverage —
  37: 'Turn on axes that stay energized (are NOT de-energized) while idle — they hold position.',
  47: 'Bitmask: which axes home in the 4th cycle.',
  103: 'Steps per unit for the A axis (rotary: steps per degree).',
  104: 'Steps per mm for the B axis (Y2 tandem).',
  113: 'Maximum rate of the A axis.',
  114: 'Maximum rate of the B axis (Y2 tandem).',
  123: 'A-axis acceleration (mm/s²).',
  124: 'B-axis acceleration (mm/s²).',
  133: 'Maximum A-axis travel.',
  134: 'Maximum B-axis travel.',
  346: 'Tool change options (bitmask).',
  347: 'Allowed length difference for auto-square (Y/Y2), in %.',
  370: 'Bitmask: invert the auxiliary (AUX) inputs.',
  372: 'Bitmask: invert the auxiliary (AUX) outputs (VAC = bit0).',
  376: 'Mark rotary axes (angle in degrees instead of mm). Chosen only among axes beyond X/Y/Z.',
  384: 'Do not persist the G92 offset after reset/restart.',
  394: 'Delay before the spindle starts (s) — to let it reach speed.',
  398: 'Number of blocks in the motion planner (lookahead).',
  673: 'Delay before the coolant turns on. Seconds. Min: 0.5, Max: 20.'
}

/** Serbian description overrides; fall back to the English SETTING_DESC above. */
export const SETTING_DESC_SR: Record<number, string> = {
  0: 'Trajanje step impulsa u mikrosekundama (obično 10).',
  1: 'Koliko ms drajveri ostaju aktivni po zaustavljanju (255 = uvek).',
  2: 'Bitmaska: invertuj step impuls po osama.',
  3: 'Bitmaska: invertuj smer kretanja po osama (ako se osa kreće obrnuto).',
  4: 'Invertuj enable pin drajvera (ako drajveri rade obrnuto).',
  5: 'Bitmaska: invertuj limit prekidače (NC vs NO ožičenje).',
  6: 'Invertuj probe ulaz (ako okida obrnuto).',
  10: 'Šta status izveštaj sadrži (MPos/WPos, buffer…).',
  11: 'Junction deviation — zaobljavanje na uglovima (mm). Manje = oštrije/sporije.',
  12: 'Arc tolerance — tačnost lukova (mm). Manje = glatkiji luk.',
  13: 'Izveštaj pozicije u inčima (0=mm, 1=inch).',
  20: 'Soft limits — zaustavi pre nego pređeš radni prostor (zahteva homing).',
  21: 'Hard limits — zaustavi na fizičkim limit prekidačima.',
  22: 'Uključi homing ciklus (potrebni limit prekidači).',
  23: 'Bitmaska: smer homing-a po osama (ka kom kraju ide).',
  24: 'Spora brzina pri preciznom nalaženju nule (mm/min).',
  25: 'Brza brzina pri traženju limita u homing-u (mm/min).',
  26: 'Debounce limit prekidača (ms), protiv lažnih okidanja.',
  27: 'Pull-off — koliko se odmakne od limita posle homing-a (mm).',
  30: 'Maksimalna brzina vretena (RPM) — odgovara 10V / S-max.',
  31: 'Minimalna brzina vretena (RPM).',
  32: 'Laser mod — kontinualno kretanje uz PWM (za laser/CO₂).',
  100: 'Koraka po mm za X osu (kalibracija X).',
  101: 'Koraka po mm za Y osu (kalibracija Y).',
  102: 'Koraka po mm za Z osu (kalibracija Z).',
  110: 'Maksimalna brzina X ose (mm/min).',
  111: 'Maksimalna brzina Y ose (mm/min).',
  112: 'Maksimalna brzina Z ose (mm/min).',
  120: 'Ubrzanje X ose (mm/s²). Veće = brži start/stop, rizik gubitka koraka.',
  121: 'Ubrzanje Y ose (mm/s²).',
  122: 'Ubrzanje Z ose (mm/s²).',
  130: 'Maksimalni hod X ose (mm) — za soft limits.',
  131: 'Maksimalni hod Y ose (mm).',
  132: 'Maksimalni hod Z ose (mm).',
  70: 'Bitmaska mrežnih servisa (telnet/websocket/http).',
  374: 'Indeks brzine Modbus komunikacije.',
  395: 'Podrazumevano vreteno pri startu (PWM / Modbus).',
  37: 'Uključi ose koje ostaju pod naponom (NE obesnažuju se) dok miruju — drže poziciju.',
  47: 'Bitmaska: koje ose homuju u 4. ciklusu.',
  103: 'Koraka po jedinici za A osu (kod rotacione: koraka po stepenu).',
  104: 'Koraka po mm za B osu (Y2 tandem).',
  113: 'Maksimalna brzina A ose.',
  114: 'Maksimalna brzina B ose (Y2 tandem).',
  123: 'Ubrzanje A ose (mm/s²).',
  124: 'Ubrzanje B ose (mm/s²).',
  133: 'Maksimalni hod A ose.',
  134: 'Maksimalni hod B ose.',
  346: 'Opcije promene alata (bitmaska).',
  347: 'Dozvoljena razlika dužine kod auto-square (Y/Y2), u %.',
  370: 'Bitmaska: invertuj pomoćne (AUX) ulaze.',
  372: 'Bitmaska: invertuj pomoćne (AUX) izlaze (VAC = bit0).',
  376: 'Označi rotacione ose (ugao u stepenima umesto mm). Bira se samo među osama iznad X/Y/Z.',
  384: 'Ne pamti G92 offset posle reseta/restarta.',
  394: 'Kašnjenje pre nego vreteno krene (s) — da dostigne brzinu.',
  398: 'Broj blokova u planeru kretanja (lookahead).',
  673: 'Kašnjenje pre uključenja coolant-a. Sekunde. Min: 0.5, Max: 20.'
}

export function settingDesc(n: number, lang: Lang = 'en'): string | undefined {
  return (lang === 'sr' && SETTING_DESC_SR[n]) || SETTING_DESC[n]
}

/** Simple on/off (0/1) settings — rendered as a toggle, not a typed value. */
export const BOOL_SETTINGS = new Set<number>([
  6, 19, 20, 21, 39, 40, 60, 62, 64, 336, 384, 483, 484, 485, 732
])

/** Per-axis bitmask settings (bit i = axis i) — rendered as one switch per axis. */
export const AXIS_MASK_SETTINGS = new Set<number>([2, 3, 4, 5, 8, 18, 23, 37, 44, 45, 46, 47, 48, 49, 671, 742, 743])

/** Rotary-axis masks: the value is offset — bit 0 = first rotary axis (A);
 *  firmware shifts <<3, so only axes beyond X/Y/Z are selectable. */
export const ROTARY_MASK_SETTINGS = new Set<number>([376, 538])

/** Named bits for non-axis bitmask settings (index = bit number), English source.
 *  Labels are the authoritative ones from Firmware/grbl/settings.c. "N/A" bits are
 *  hidden. Serbian overrides live in MASK_BITS_SR. */
export const MASK_BITS: Record<number, string[]> = {
  9: ['Enable', 'RPM controls spindle enable', 'Disable laser mode', 'Enable ramping'],
  10: [
    'Position in machine coords', 'Buffer state', 'Line numbers', 'Feed & speed', 'Pin state',
    'Work coordinate offset', 'Overrides', 'Probe coordinates', 'Buffer sync on WCO', 'Parser state',
    'Alarm substatus', 'Run substatus', 'Enable when homing', 'Distance-to-go'
  ],
  16: ['Spindle enable', 'Spindle direction', 'PWM'],
  41: ['Enable', 'Deactivate on init', 'Parking override control'],
  486: ['G59.1', 'G59.2', 'G59.3'],
  // Only Telnet/Websocket/FTP are compiled in this build (my_machine.h); the rest
  // are off → 'N/A' (hidden) while keeping the bit positions correct.
  70: ['Telnet', 'Websocket', 'N/A', 'FTP', 'N/A', 'N/A', 'N/A', 'N/A'],
  61: ['Ignore when idle', 'Keep coolant on door open'],
  63: ['Disable laser during hold', 'Restore spindle/coolant on resume'],
  65: ['Allow feed override', 'Apply soft limits', 'N/A', 'Auto select toolsetter', 'Auto select probe 2', 'Probe protection'],
  346: ['Restore position after M6', 'Change tool at G30', 'Fast probe pull off'],
  // Only VAC (aux output port 0) is a generic digital output on this board; MIST/FLOOD
  // are claimed as coolant, so both invert ($372) and open-drain ($373) have one bit.
  // Without this the generic view falls back to meaningless "bit 0..3" numbered switches.
  372: ['VAC'],
  373: ['VAC'],
  650: ['Auto-mount SD card on startup', 'Hide LittleFS', 'Hierarchical listing'],
  676: ['Clear homed status if position lost', 'Clear offsets (except G92)', 'Clear rapids override', 'Clear feed override'],
  700: ['Prescan internal M98 subroutines'],
  // second spindle ($709/$716) — same bits as $9/$16
  709: ['Enable', 'RPM controls spindle enable', 'Disable laser mode', 'Enable ramping'],
  716: ['Spindle enable', 'Spindle direction', 'PWM']
}

/** Serbian overrides for mask bit labels; missing entries fall back to English. */
export const MASK_BITS_SR: Record<number, string[]> = {
  650: ['Auto-mount SD na startu', 'Sakrij LittleFS', 'Hijerarhijski listing']
}

/** Free-text settings (IP / hostname / SSID / URI / timezone …). Detected on the
 *  English name, which is language-independent. */
function isTextSetting(n: number): boolean {
  return /address|gateway|netmask|hostname|ssid|password|uri|name|timezone/i.test(settingName(n, 'en'))
}

export type GenericKind = 'bool' | 'axisMask' | 'bitFlags' | 'text' | 'value'

/** How a not-otherwise-curated setting should be presented. */
export function genericKind(n: number): GenericKind {
  if (BOOL_SETTINGS.has(n)) return 'bool'
  if (AXIS_MASK_SETTINGS.has(n)) return 'axisMask'
  if (n in MASK_BITS) return 'bitFlags'
  if (/\(mask\)/i.test(settingName(n, 'en'))) return 'bitFlags' // any other mask → generic numbered bits
  if (isTextSetting(n)) return 'text'
  return 'value'
}

/** Bit switches for a mask setting: named bits when known (in `lang`), else enough
 *  numbered bits to cover the current value (min 4). Never requires typing a number. */
export function maskBits(n: number, value: number, lang: Lang = 'en'): { bit: number; label: string }[] {
  const known = (lang === 'sr' && MASK_BITS_SR[n]) || MASK_BITS[n]
  if (known) return known.map((label, bit) => ({ bit, label })).filter((b) => b.label !== 'N/A')
  let hi = 3
  for (let i = 0; i < 16; i++) if (value & (1 << i)) hi = Math.max(hi, i)
  return Array.from({ length: hi + 1 }, (_, bit) => ({ bit, label: `bit ${bit}` }))
}
