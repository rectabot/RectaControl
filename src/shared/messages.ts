/**
 * Human-readable grblHAL alarm and error catalogue.
 *
 * Each code carries a short `title` (for the status bar / inline decode), a
 * `cause` ("when does this happen"), a `recovery` ("what do I do to continue"),
 * a `group` (so the reference can organise them), and optional `actions` — the
 * one-tap recovery buttons (Unlock $X / Home $H / Reset) the UI can offer.
 *
 * Codes and short descriptions follow the grblHAL core tables (errors.h /
 * errors.c, alarms.h / alarms.c). Filesystem/SD codes (60-66, 84, 85) and the
 * Bluetooth code (70) are registered by plugins, not the core table, so their
 * wording is ours but the numbers are authoritative. Recovery steps are ours
 * (domain knowledge) — the codes are never invented.
 *
 * English is the source; Serbian overrides fall back to English field-by-field.
 */
import type { Lang } from './i18n'

/** One-tap recovery the UI can surface for a live alarm/error. */
export type RecoveryAction = 'unlock' | 'home' | 'reset' | 'freeSwitch'

/** Where a code belongs in the reference, for grouped display. */
export type CodeGroup =
  | 'motion' // limits, homing, travel, soft limits
  | 'state' // machine state: idle, locked, door, e-stop, tool change
  | 'gcode' // g-code parsing / program errors
  | 'system' // settings, self-test, motor/expander/modbus faults
  | 'file' // SD card / filesystem
  | 'macro' // expressions & flow-control (macros)
  | 'other'

/** One step of a guided recovery.
 *
 *  `do` is either a wired machine command (the popup arms that button) or
 *  'manual' — something the operator does at the machine, confirmed by hand.
 *  `goto` deep-links into the Settings category where the fix lives, so the
 *  operator is taken to the control instead of being told its number. */
export interface RecoveryStep {
  do: RecoveryAction | 'manual'
  text: string
  goto?: string
  /** Only shown on machines with homing DISABLED ($22 off). Some remedies exist
   *  purely because $H isn't available — e.g. crawling off a hard-limit switch by
   *  hand, which homing does on its own. */
  ifNoHoming?: boolean
}

export interface CodeDetail {
  title: string
  cause: string
  recovery: string
  group: CodeGroup
  /** the ordered procedure; when present it is the source of truth and `actions`
   *  is derived from it (so the badges and the popup can never disagree) */
  steps?: RecoveryStep[]
  actions?: RecoveryAction[]
}

/** SR overrides may fill any subset of the text fields; the rest fall back to EN.
 *  `steps` is the parallel list of step texts, in the same order as the EN steps —
 *  only the wording is translated, never the procedure. */
type CodeDetailSR = Partial<Pick<CodeDetail, 'title' | 'cause' | 'recovery'>> & {
  steps?: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// ALARMS — machine-halting events. All require the operator to clear/unlock or
// re-home before work can continue.
// ─────────────────────────────────────────────────────────────────────────────

export const ALARMS: Record<number, CodeDetail> = {
  1: {
    title: 'Hard limit triggered',
    cause:
      'A limit switch was hit during motion. The machine halts immediately, so the position is no longer trusted.',
    recovery:
      'Reset first — a hard limit is a critical event, so nothing else is accepted. Then unlock ($X), get the axis clear of the switch (with hard limits temporarily off, or by hand), and re-home ($H). If it fires with nothing near the switch, check wiring/noise.',
    group: 'motion',
    steps: [
      {
        do: 'reset',
        text: 'Reset first — nothing else is accepted while a critical event is active.'
      },
      {
        do: 'unlock',
        text: 'Unlock. The lock is cleared, but the position is not trusted yet.'
      },
      {
        do: 'freeSwitch',
        text: 'Back the axis off the switch. While it is pressed nothing moves — not even homing.'
      },
      { do: 'home', text: 'Home to restore an accurate machine position.' }
    ]
  },
  2: {
    title: 'Soft limit reached',
    cause:
      'A commanded move would have taken an axis past its configured travel ($130–$132). The move was blocked before it started; position is retained.',
    recovery:
      'Reset first — a soft limit is a critical event as well — then unlock ($X); the machine did not move. Adjust your work origin or the G-code so all moves stay inside the work area.',
    group: 'motion',
    steps: [
      {
        do: 'reset',
        text: 'Reset first — nothing else is accepted while a critical event is active.'
      },
      {
        do: 'unlock',
        text: 'Unlock. The machine never moved, so the position is still good.'
      },
      {
        do: 'manual',
        text: 'Move the work origin, or edit the program, so every move stays inside the travel.',
        goto: 'limits'
      }
    ]
  },
  3: {
    title: 'Reset while in motion',
    cause:
      'A soft reset or E-stop happened while the machine was moving, so it stopped abruptly and lost its position.',
    recovery: 'Unlock ($X), then re-home ($H) before running any job.',
    group: 'motion',
    steps: [
      { do: 'unlock', text: 'Unlock to clear the alarm lock.' },
      { do: 'home', text: 'Home — the abrupt stop lost the position.' }
    ]
  },
  4: {
    title: 'Probe fail — already triggered',
    cause: 'The probe was already in its triggered state when a probing cycle (G38.2/G38.3) began.',
    recovery:
      'Check the probe is clear of the workpiece and wired correctly (not stuck closed). Unlock ($X) and retry the probe.',
    group: 'state',
    steps: [
      {
        do: 'manual',
        text: 'Free the probe. It must read OPEN before a cycle — not stuck on the work or shorted.',
        goto: 'probe'
      },
      { do: 'unlock', text: 'Unlock, then run the probe again.' }
    ]
  },
  5: {
    title: 'Probe fail — no contact',
    cause: 'The probe did not touch the workpiece within the programmed probing distance (G38.2/G38.4).',
    recovery:
      'Unlock ($X). Position the probe closer, increase the probing distance, and confirm the probe signal responds before retrying.',
    group: 'state',
    steps: [
      { do: 'unlock', text: 'Unlock.' },
      {
        do: 'manual',
        text: 'Start closer, or increase the probing distance. Check the probe reacts to a touch.',
        goto: 'probe'
      }
    ]
  },
  6: {
    title: 'Homing failed — reset',
    cause: 'A reset was received while the homing cycle was running.',
    recovery: 'Run homing again ($H). If it keeps aborting, check for E-stop or noise on the reset line.',
    group: 'motion',
    steps: [
      {
        do: 'manual',
        text: 'Find what reset the controller mid-cycle: E-stop, a loose reset line, noise.'
      },
      { do: 'home', text: 'Run homing again.' }
    ]
  },
  7: {
    title: 'Homing failed — door opened',
    cause: 'The safety door was opened during the homing cycle.',
    recovery: 'Close the safety door, then run homing again ($H).',
    group: 'motion',
    steps: [
      {
        do: 'manual',
        text: 'Close the safety door and keep it closed for the whole cycle.'
      },
      { do: 'home', text: 'Run homing again.' }
    ]
  },
  8: {
    title: 'Homing failed — pull-off',
    cause: 'After touching the limit switch the axis could not back off far enough to release it.',
    recovery: 'Check the switch and wiring. Increase the pull-off distance ($27), then re-home ($H).',
    group: 'motion',
    steps: [
      {
        do: 'manual',
        text: 'Check the switch releases when the axis backs off. If not, raise the pull-off ($27).',
        goto: 'homing'
      },
      { do: 'home', text: 'Home again.' }
    ]
  },
  9: {
    title: 'Homing failed — switch not found',
    cause: 'The axis travelled the full search distance without reaching a limit switch.',
    recovery:
      'Confirm the switch triggers (check wiring / $ status), increase max travel or homing feed, then re-home ($H).',
    group: 'motion',
    steps: [
      {
        do: 'manual',
        text: 'Press the switch by hand and watch Pn: in the status bar. Nothing? It is wiring.',
        goto: 'limits'
      },
      {
        do: 'manual',
        text: 'It reacts? Then the axis never reaches it — check max travel and the seek rate.',
        goto: 'homing'
      },
      { do: 'home', text: 'Home again.' }
    ]
  },
  10: {
    title: 'Emergency stop active',
    cause: 'The E-stop input is asserted.',
    recovery: 'Release the E-stop button, then reset the controller to clear the alarm.',
    group: 'state',
    steps: [
      {
        do: 'manual',
        text: 'Release the E-stop button — the input must be clear first.'
      },
      { do: 'reset', text: 'Reset to clear the alarm.' }
    ]
  },
  11: {
    title: 'Homing required',
    cause: 'The machine has not been homed since power-up and a move needs a known position.',
    recovery: 'Run homing ($H) before working.',
    group: 'motion',
    steps: [
      {
        do: 'home',
        text: 'Run homing ($H) — nothing else is needed, the machine just wants a reference.'
      }
    ]
  },
  12: {
    title: 'Limit switch engaged at start',
    cause: 'A limit switch is already active — the machine is likely sitting on a switch after power-on.',
    recovery:
      'Unlock ($X) and jog the axis off the switch, then re-home ($H). If nothing is on the switch, check wiring/noise.',
    group: 'motion',
    steps: [
      { do: 'unlock', text: 'Unlock so the machine will take a move.' },
      {
        do: 'freeSwitch',
        text: 'Back the axis off the switch. While it is pressed nothing moves — not even homing.'
      },
      { do: 'home', text: 'Home to restore an accurate machine position.' }
    ]
  },
  13: {
    title: 'Probe protection triggered',
    cause: 'The probe was hit unexpectedly outside a probing cycle.',
    recovery: 'Clear the obstruction, unlock ($X), and check the probe wiring.',
    group: 'state',
    steps: [
      {
        do: 'manual',
        text: 'Clear whatever touched the probe and check its cable — a loose wire trips this.',
        goto: 'probe'
      },
      { do: 'unlock', text: 'Unlock.' }
    ]
  },
  14: {
    title: 'Spindle at-speed timeout',
    cause:
      'The spindle did not reach the commanded speed within the allowed time (spindle-at-speed feedback).',
    recovery:
      'Check the VFD/spindle and the at-speed signal. Reset to clear, then retry. Increase the tolerance/timeout if the spindle simply needs longer to spin up.',
    group: 'state',
    steps: [
      {
        do: 'manual',
        text: 'Check the spindle reaches the commanded speed and the at-speed signal arrives.',
        goto: 'spindle'
      },
      { do: 'reset', text: 'Reset to clear, then start again.' }
    ]
  },
  15: {
    title: 'Homing failed — second switch (auto-square)',
    cause: 'On an auto-squared axis the second limit switch was not found within the search distance.',
    recovery: 'Check the second motor’s switch and wiring, adjust travel/pull-off, then re-home ($H).',
    group: 'motion',
    steps: [
      {
        do: 'manual',
        text: 'Press the SECOND motor’s switch by hand — auto-square needs both to be seen.',
        goto: 'autosquare'
      },
      {
        do: 'manual',
        text: 'It reacts? Give the axis room: check travel and pull-off for the squaring move.',
        goto: 'homing'
      },
      { do: 'home', text: 'Home again.' }
    ]
  },
  16: {
    title: 'Power-on self-test failed',
    cause: 'The controller’s power-on self-test (POS) did not pass.',
    recovery: 'Reset the controller. If it persists it points to a firmware/hardware fault.',
    group: 'system',
    steps: [
      { do: 'reset', text: 'Reset the controller.' },
      {
        do: 'manual',
        text: 'Back after every reset? Not an operating mistake — re-flash and check the board.',
        goto: 'firmware'
      }
    ]
  },
  17: {
    title: 'Motor fault',
    cause: 'A driver reported a fault (e.g. a stepper driver fault/alarm output).',
    recovery: 'Check driver power, wiring and temperature. Reset once the driver is healthy.',
    group: 'system',
    steps: [
      {
        do: 'manual',
        text: 'Check the driver that faulted: power, step/dir wiring, temperature, fault output.',
        goto: 'motors'
      },
      { do: 'reset', text: 'Reset once the driver is healthy again.' }
    ]
  },
  18: {
    title: 'Homing failed — bad configuration',
    cause: 'The homing configuration is invalid (e.g. no homing switches assigned).',
    recovery:
      'Review the homing settings ($22 and the $44–$47 cycle masks) and the limit-switch inputs, then re-home.',
    group: 'motion',
    steps: [
      {
        do: 'manual',
        text: 'Fix the homing setup: the cycle masks must name axes that actually have switches.',
        goto: 'homing'
      },
      { do: 'home', text: 'Home once the configuration is valid.' }
    ]
  },
  19: {
    title: 'Modbus exception',
    cause: 'A Modbus timeout or message error (typically VFD spindle communication).',
    recovery:
      'Check the RS-485 wiring, VFD address and baud rate. Reset to clear once communication is restored.',
    group: 'system',
    steps: [
      {
        do: 'manual',
        text: 'Power the VFD and check RS-485 on CN32: A+/B− not swapped, shared GND, wired up.'
      },
      {
        do: 'manual',
        text: 'Match the settings to the VFD: Modbus address, baud rate, spindle selection.',
        goto: 'spindle'
      },
      { do: 'reset', text: 'Reset once communication is restored.' }
    ]
  },
  20: {
    title: 'I/O expander fault',
    cause: 'Communication with an I/O expander failed.',
    recovery: 'Check the expander’s wiring/power, then reset.',
    group: 'system',
    steps: [
      {
        do: 'manual',
        text: 'Check the expander’s power and bus wiring.',
        goto: 'inputs'
      },
      { do: 'reset', text: 'Reset once it is wired and powered.' }
    ]
  },
  21: {
    title: 'Storage (EEPROM) failure',
    cause: 'Non-volatile storage (settings memory) could not be read or written.',
    recovery:
      'Reset. If settings do not persist, re-flash / restore defaults; a persistent failure points to the storage chip.',
    group: 'system',
    steps: [
      { do: 'reset', text: 'Reset the controller.' },
      {
        do: 'manual',
        text: 'Settings keep reverting? Restore defaults or re-flash — otherwise it is the chip.',
        goto: 'advanced'
      }
    ]
  }
}

const ALARMS_SR: Record<number, CodeDetailSR> = {
  1: {
    title: 'Hard limit okinut',
    cause:
      'Krajnji (limit) prekidač je pogođen tokom kretanja. Mašina se odmah zaustavlja pa se pozicija više ne smatra tačnom.',
    recovery:
      'Prvo Reset — hard limit je kritičan događaj pa ništa drugo nije prihvaćeno. Onda otključaj ($X), skloni osu sa prekidača (privremeno bez hard limita ili rukom) i homuj ($H). Ako okida a ništa nije blizu prekidača — proveri ožičenje/smetnje.',
    steps: [
      'Prvo Reset — dok je kritičan događaj aktivan ništa drugo ne prolazi.',
      'Otključaj. Brava je skinuta, ali pozicija još nije pouzdana.',
      'Odmakni osu sa prekidača. Dok je pritisnut ništa se ne miče — ni homing.',
      'Homuj da vratiš tačnu mašinsku poziciju.'
    ]
  },
  2: {
    title: 'Dostignut soft limit',
    cause:
      'Komandni potez bi izveo osu van podešenog radnog hoda ($130–$132). Potez je blokiran pre početka; pozicija je sačuvana.',
    recovery:
      'Prvo Reset — i soft limit je kritičan događaj — pa otključaj ($X); mašina se nije pomerila. Pomeri nulu obratka ili izmeni G-code tako da svi potezi ostanu u radnom prostoru.',
    steps: [
      'Prvo Reset — dok je kritičan događaj aktivan ništa drugo ne prolazi.',
      'Otključaj. Mašina se nije pomerila, pozicija je i dalje dobra.',
      'Pomeri nulu obratka ili izmeni program tako da svi potezi ostanu unutar hoda.'
    ]
  },
  3: {
    title: 'Reset tokom kretanja',
    cause: 'Soft reset ili E-stop se desio dok se mašina kretala, pa je naglo stala i izgubila poziciju.',
    recovery: 'Otključaj ($X), pa ponovo homuj ($H) pre pokretanja bilo kog posla.',
    steps: ['Otključaj da skineš bravu alarma.', 'Homuj — nagli stop je izgubio poziciju.']
  },
  4: {
    title: 'Probe greška — već okinut',
    cause: 'Probe je već bio u okinutom stanju kada je probni ciklus (G38.2/G38.3) počeo.',
    recovery:
      'Proveri da je probe slobodan i pravilno ožičen (nije zaglavljen). Otključaj ($X) i ponovi probanje.',
    steps: [
      'Oslobodi sondu. Mora da bude OTVORENA pre ciklusa — ne zaglavljena ni u kratkom.',
      'Otključaj pa ponovi probanje.'
    ]
  },
  5: {
    title: 'Probe greška — nema kontakta',
    cause: 'Probe nije dodirnuo obradak u okviru zadate razdaljine probanja (G38.2/G38.4).',
    recovery:
      'Otključaj ($X). Primakni probe bliže, povećaj razdaljinu probanja i potvrdi da signal probe reaguje pre ponovnog pokušaja.',
    steps: ['Otključaj.', 'Kreni bliže ili povećaj razdaljinu probanja. Proveri da sonda reaguje na dodir.']
  },
  6: {
    title: 'Homing neuspešan — reset',
    cause: 'Reset je stigao dok je homing ciklus bio u toku.',
    recovery: 'Pokreni homing ponovo ($H). Ako stalno prekida — proveri E-stop ili smetnje na reset liniji.',
    steps: [
      'Nađi šta je resetovalo kontroler usred ciklusa: E-stop, labava reset linija, smetnje.',
      'Pokreni homing ponovo.'
    ]
  },
  7: {
    title: 'Homing neuspešan — vrata otvorena',
    cause: 'Safety door je otvoren tokom homing ciklusa.',
    recovery: 'Zatvori safety door, pa pokreni homing ponovo ($H).',
    steps: ['Zatvori safety door i drži ga zatvorenog ceo homing ciklus.', 'Pokreni homing ponovo ($H).']
  },
  8: {
    title: 'Homing neuspešan — pull-off',
    cause: 'Posle dodira sa prekidačem osa nije mogla dovoljno da se odmakne da ga otpusti.',
    recovery: 'Proveri prekidač i ožičenje. Povećaj pull-off razdaljinu ($27), pa ponovo homuj ($H).',
    steps: [
      'Proveri da se prekidač otpušta kad se osa odmakne. Ako ne — povećaj pull-off ($27).',
      'Homuj ponovo.'
    ]
  },
  9: {
    title: 'Homing neuspešan — prekidač nije nađen',
    cause: 'Osa je prešla celu razdaljinu pretrage a nije stigla do krajnjeg prekidača.',
    recovery:
      'Potvrdi da prekidač okida (ožičenje / $ status), povećaj max hod ili homing brzinu, pa ponovo homuj ($H).',
    steps: [
      'Pritisni prekidač rukom i gledaj Pn: u statusnoj traci. Ništa? Problem je ožičenje.',
      'Reaguje? Onda osa ne stiže do njega — proveri max hod i seek brzinu.',
      'Homuj ponovo.'
    ]
  },
  10: {
    title: 'Sigurnosni stop (E-stop) aktivan',
    cause: 'E-stop ulaz je aktiviran.',
    recovery: 'Otpusti E-stop taster, pa resetuj kontroler da obrišeš alarm.',
    steps: ['Otpusti E-stop taster — ulaz prvo mora da bude čist.', 'Resetuj da obrišeš alarm.']
  },
  11: {
    title: 'Potreban homing',
    cause: 'Mašina nije homovana od paljenja, a potez zahteva poznatu poziciju.',
    recovery: 'Pokreni homing ($H) pre rada.',
    steps: ['Pokreni homing ($H) — ništa drugo ne treba, mašina samo traži referencu.']
  },
  12: {
    title: 'Limit prekidač aktivan na startu',
    cause: 'Krajnji prekidač je već aktivan — mašina verovatno stoji na prekidaču posle paljenja.',
    recovery:
      'Otključaj ($X) i odjoguj osu sa prekidača, pa ponovo homuj ($H). Ako ništa nije na prekidaču — proveri ožičenje/smetnje.',
    steps: [
      'Otključaj da mašina prihvati potez.',
      'Odmakni osu sa prekidača. Dok je pritisnut ništa se ne miče — ni homing.',
      'Homuj da vratiš tačnu mašinsku poziciju.'
    ]
  },
  13: {
    title: 'Zaštita probe okinuta',
    cause: 'Probe je neočekivano pogođen van probnog ciklusa.',
    recovery: 'Ukloni prepreku, otključaj ($X) i proveri ožičenje probe.',
    steps: ['Ukloni ono što je dodirnulo sondu i proveri kabl — labava žica okida ovo sama.', 'Otključaj.']
  },
  14: {
    title: 'Istek vremena „spindle at speed”',
    cause: 'Spindl nije dostigao komandovanu brzinu u dozvoljenom vremenu (at-speed povratni signal).',
    recovery:
      'Proveri VFD/spindl i at-speed signal. Resetuj da obrišeš pa ponovi. Povećaj toleranciju/timeout ako spindlu jednostavno treba više vremena da se zavrti.',
    steps: [
      'Proveri da spindl dostiže komandovanu brzinu i da at-speed signal stiže.',
      'Resetuj da obrišeš, pa kreni ponovo.'
    ]
  },
  15: {
    title: 'Homing neuspešan — drugi prekidač (auto-square)',
    cause: 'Na auto-square osi drugi krajnji prekidač nije nađen u razdaljini pretrage.',
    recovery: 'Proveri prekidač i ožičenje drugog motora, podesi hod/pull-off, pa ponovo homuj ($H).',
    steps: [
      'Pritisni rukom prekidač DRUGOG motora — auto-square traži da se vide oba.',
      'Reaguje? Daj osi prostora: proveri hod i pull-off za poravnavajući potez.',
      'Homuj ponovo.'
    ]
  },
  16: {
    title: 'Self-test na paljenju neuspešan',
    cause: 'Power-on self-test (POS) kontrolera nije prošao.',
    recovery: 'Resetuj kontroler. Ako se ponavlja — ukazuje na firmware/hardver kvar.',
    steps: [
      'Resetuj kontroler.',
      'Vraća se posle svakog reseta? Nije greška u radu — reflešuj i proveri ploču.'
    ]
  },
  17: {
    title: 'Kvar motora',
    cause: 'Drajver je prijavio kvar (npr. fault/alarm izlaz stepper drajvera).',
    recovery: 'Proveri napajanje drajvera, ožičenje i temperaturu. Resetuj kad je drajver ispravan.',
    steps: [
      'Proveri drajver koji je pao: napajanje, step/dir ožičenje, temperatura, fault izlaz.',
      'Resetuj kad je drajver ponovo ispravan.'
    ]
  },
  18: {
    title: 'Homing neuspešan — loša konfiguracija',
    cause: 'Homing konfiguracija je nevažeća (npr. nisu dodeljeni homing prekidači).',
    recovery: 'Pregledaj homing podešavanja ($22 i maske ciklusa $44–$47) i limit ulaze, pa ponovo homuj.',
    steps: [
      'Ispravi homing podešavanja: maske ciklusa moraju da imenuju ose koje imaju prekidače.',
      'Homuj kad je konfiguracija ispravna.'
    ]
  },
  19: {
    title: 'Modbus izuzetak',
    cause: 'Modbus timeout ili greška poruke (najčešće komunikacija sa VFD spindlom).',
    recovery:
      'Proveri RS-485 ožičenje, adresu VFD-a i baud rate. Resetuj da obrišeš kad se komunikacija uspostavi.',
    steps: [
      'Napoji VFD i proveri RS-485 na CN32: A+/B− nisu zamenjeni, zajednička GND, povezano.',
      'Uskladi podešavanja sa VFD-om: Modbus adresa, baud rate, izbor spindla.',
      'Resetuj kad je komunikacija uspostavljena.'
    ]
  },
  20: {
    title: 'Kvar I/O ekspandera',
    cause: 'Komunikacija sa I/O ekspanderom je otkazala.',
    recovery: 'Proveri ožičenje/napajanje ekspandera, pa resetuj.',
    steps: ['Proveri napajanje ekspandera i ožičenje magistrale.', 'Resetuj kad je povezan i napajan.']
  },
  21: {
    title: 'Otkaz memorije (EEPROM)',
    cause: 'Trajna memorija (memorija podešavanja) nije mogla da se pročita ili upiše.',
    recovery:
      'Resetuj. Ako podešavanja ne ostaju — re-flešuj / vrati fabrička; trajni otkaz ukazuje na memorijski čip.',
    steps: ['Resetuj kontroler.', 'Podešavanja se vraćaju? Vrati fabrička ili reflešuj — inače je sam čip.']
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS — a command was rejected. The machine keeps running; the offending
// line/command is what needs attention.
// ─────────────────────────────────────────────────────────────────────────────

export const ERRORS: Record<number, CodeDetail> = {
  1: {
    title: 'G-code word missing its value',
    cause: 'A G-code word is just a letter with no number after it (e.g. "X" with no value).',
    recovery: 'Fix the offending line — every word needs a value. Usually a CAM/post-processor glitch.',
    group: 'gcode'
  },
  2: {
    title: 'Bad number format',
    cause: 'A numeric value is malformed or an expected value is missing.',
    recovery: 'Correct the number on that line and re-send. Check the post-processor if it recurs.',
    group: 'gcode'
  },
  3: {
    title: 'Unknown $ command',
    cause: 'The "$" system command was not recognised or is not supported by this build.',
    recovery: 'Check the command spelling. Use $$ / $HELP to list what this firmware supports.',
    group: 'system'
  },
  4: {
    title: 'Negative value not allowed',
    cause: 'A negative number was given where a positive value is required.',
    recovery: 'Enter a positive value.',
    group: 'gcode'
  },
  5: {
    title: 'Homing not enabled',
    cause: 'A homing command was issued but homing is disabled in settings ($22).',
    recovery: 'Enable homing ($22) and configure the homing cycle, or don’t call $H.',
    group: 'motion'
  },
  6: {
    title: 'Step pulse too short',
    cause: 'The step pulse time ($0) was set below the minimum (2 µs).',
    recovery: 'Set $0 to 2 µs or higher.',
    group: 'system'
  },
  7: {
    title: 'Settings read failed',
    cause: 'A stored setting could not be read; affected settings were auto-restored to defaults.',
    recovery: 'Re-check and save your settings. Persistent failures point to the storage chip.',
    group: 'system'
  },
  8: {
    title: 'Only allowed when idle',
    cause: 'A "$" command was sent while the machine was not in the Idle state.',
    recovery: 'Wait until the job/motion finishes (state = Idle), then send the command.',
    group: 'state'
  },
  9: {
    title: 'Locked out (alarm/jog)',
    cause: 'G-code is locked while the machine is in an alarm or jog state.',
    recovery: 'Clear the alarm — unlock ($X) or home ($H) — before sending G-code.',
    group: 'state',
    actions: ['unlock', 'home']
  },
  10: {
    title: 'Soft limits need homing',
    cause: 'Soft limits ($20) cannot be enabled unless homing ($22) is also enabled.',
    recovery: 'Enable homing first, or disable soft limits.',
    group: 'motion'
  },
  11: {
    title: 'Line too long',
    cause: 'The received line exceeded the input buffer and was not executed.',
    recovery: 'Shorten the line. Often stray characters or a comms/encoding problem.',
    group: 'other'
  },
  12: {
    title: 'Step rate too high',
    cause: 'A setting value would push the step rate above what the hardware supports.',
    recovery: 'Lower the steps/mm ($100–$102) or the max rate ($110–$112).',
    group: 'system'
  },
  13: {
    title: 'Safety door open',
    cause: 'The safety door is detected as open, so door (parking) state was entered.',
    recovery: 'Close the door, then reset/resume to continue.',
    group: 'state',
    actions: ['reset']
  },
  14: {
    title: 'Startup line too long',
    cause: 'A startup line ($N) or build-info string exceeded the length limit and was not stored.',
    recovery: 'Shorten the startup line.',
    group: 'system'
  },
  15: {
    title: 'Jog exceeds travel',
    cause: 'A jog target is outside the machine’s travel; the jog was ignored.',
    recovery: 'Jog a smaller distance, or home so soft limits know where you are.',
    group: 'motion'
  },
  16: {
    title: 'Bad jog command',
    cause: 'A "$J=" jog command has no "=" or contains G-code that isn’t allowed while jogging.',
    recovery: 'Send a well-formed $J= command (feed + one relative/absolute move).',
    group: 'gcode'
  },
  17: {
    title: 'Laser mode needs PWM',
    cause: 'Laser mode ($32) was enabled but the spindle output has no PWM.',
    recovery: 'Use a PWM-capable spindle output or disable laser mode.',
    group: 'system'
  },
  18: {
    title: 'Reset asserted',
    cause: 'A soft reset was received.',
    recovery: 'Normal after a reset — no action needed unless it was unexpected.',
    group: 'state'
  },
  19: {
    title: 'Value must be positive',
    cause: 'A non-positive value was given where a positive one is required.',
    recovery: 'Enter a value greater than zero.',
    group: 'gcode'
  },
  20: {
    title: 'Unsupported G-code command',
    cause: 'An unsupported or invalid G/M command was found in the block.',
    recovery: 'Remove or correct the command. Check the post-processor matches grblHAL.',
    group: 'gcode'
  },
  21: {
    title: 'Modal group conflict',
    cause: 'Two commands from the same modal group appeared in one block (e.g. G0 and G1).',
    recovery: 'Split them onto separate lines.',
    group: 'gcode'
  },
  22: {
    title: 'Feed rate not set',
    cause: 'A feed move (G1/G2/G3) ran with no feed rate ever set.',
    recovery: 'Add an F word before the first cutting move.',
    group: 'gcode'
  },
  23: {
    title: 'Integer value required',
    cause: 'A command that needs a whole number got a fractional one.',
    recovery: 'Use an integer for that word (e.g. the G/M code number).',
    group: 'gcode'
  },
  24: {
    title: 'Conflicting axis commands',
    cause: 'Two commands that both need axis words appeared in the same block.',
    recovery: 'Put them on separate lines.',
    group: 'gcode'
  },
  25: {
    title: 'Repeated word',
    cause: 'The same G-code word appears twice in one block.',
    recovery: 'Remove the duplicate word.',
    group: 'gcode'
  },
  26: {
    title: 'No axis words',
    cause: 'A command that needs axis words (or the current modal state) was given none.',
    recovery: 'Add the axis word(s) the command requires.',
    group: 'gcode'
  },
  27: {
    title: 'Invalid line number',
    cause: 'The N line-number value is out of the valid range.',
    recovery: 'Use a valid line number, or drop N numbering.',
    group: 'gcode'
  },
  28: {
    title: 'Missing a value word',
    cause: 'A command is missing a required value word (e.g. P or L).',
    recovery: 'Add the required word for that command.',
    group: 'gcode'
  },
  29: {
    title: 'G59.x not supported',
    cause: 'A G59.1/.2/.3 work coordinate system was used but isn’t supported here.',
    recovery: 'Use G54–G59, or enable extended WCS in the build.',
    group: 'gcode'
  },
  30: {
    title: 'G53 needs G0/G1',
    cause: 'G53 (machine coords) was used with a motion mode other than G0 or G1.',
    recovery: 'Use G53 only with G0 or G1.',
    group: 'gcode'
  },
  31: {
    title: 'Unexpected axis words',
    cause: 'Axis words appear in a block where no command uses them.',
    recovery: 'Remove the stray axis words.',
    group: 'gcode'
  },
  32: {
    title: 'Arc needs an in-plane axis',
    cause: 'A G2/G3 arc has no axis word in the active plane.',
    recovery: 'Provide the in-plane axis endpoint for the arc.',
    group: 'gcode'
  },
  33: {
    title: 'Invalid motion target',
    cause: 'The target of a motion command is invalid (often an impossible arc).',
    recovery: 'Check the endpoint and arc centre/radius on that line.',
    group: 'gcode'
  },
  34: {
    title: 'Arc radius error',
    cause: 'A radius-mode (R) arc can’t be computed — the geometry doesn’t close.',
    recovery: 'Fix the arc endpoints/radius, or use I/J/K centre-offset arcs.',
    group: 'gcode'
  },
  35: {
    title: 'Arc needs an in-plane offset',
    cause: 'A G2/G3 arc is missing its in-plane I/J/K offset word.',
    recovery: 'Add the I/J/K offset for the active plane.',
    group: 'gcode'
  },
  36: {
    title: 'Unused words in block',
    cause: 'The block contains value words no command uses.',
    recovery: 'Remove the extra words.',
    group: 'gcode'
  },
  37: {
    title: 'G43.1 wrong axis',
    cause: 'Dynamic tool-length offset (G43.1) was applied to an axis that isn’t the tool-length axis.',
    recovery: 'Apply G43.1 on the configured tool-length axis (usually Z).',
    group: 'gcode'
  },
  38: {
    title: 'Invalid tool number',
    cause: 'A tool number is greater than the maximum, or the selected tool is undefined.',
    recovery: 'Use a valid tool number / define the tool.',
    group: 'gcode'
  },
  39: {
    title: 'Value out of range',
    cause: 'A value in the block is outside the allowed range.',
    recovery: 'Bring the value into range.',
    group: 'gcode'
  },
  40: {
    title: 'Tool change pending',
    cause: 'A command was sent while a manual tool change is still pending.',
    recovery: 'Complete the tool change (acknowledge it), then continue.',
    group: 'state'
  },
  41: {
    title: 'Spindle not running',
    cause: 'Motion was commanded in CSS or spindle-sync mode while the spindle was stopped.',
    recovery: 'Start the spindle before the synchronised move.',
    group: 'gcode'
  },
  42: {
    title: 'Illegal plane',
    cause: 'Threading requires the ZX plane (G18).',
    recovery: 'Select G18 before the threading cycle.',
    group: 'gcode'
  },
  43: {
    title: 'Max feed rate exceeded',
    cause: 'The commanded feed rate is above the axis maximum.',
    recovery: 'Lower the F value or raise the max rate ($110–$112).',
    group: 'gcode'
  },
  44: {
    title: 'RPM out of range',
    cause: 'The commanded spindle RPM is outside the configured min/max ($30/$31).',
    recovery: 'Command an RPM within range, or adjust $30/$31.',
    group: 'gcode'
  },
  45: {
    title: 'Limit switch engaged',
    cause:
      'A limit switch is pressed and hard limits are in strict mode ($21 bit 1), so the controller refuses everything but homing — this is the answer to a $X sent while sitting on a switch.',
    recovery:
      'Home ($H): homing ignores the limit inputs and drives off the switch. If homing is not an option, turn strict mode (or hard limits) off in Settings, jog clear, then turn it back on.',
    group: 'motion',
    steps: [
      {
        do: 'home',
        text: 'Home ($H) — the only thing allowed while a switch is engaged. Homing ignores the limit inputs, so it drives off the switch by itself.'
      },
      {
        do: 'manual',
        text: 'No homing on this machine? Turn strict mode off ($21 bit 1) — or hard limits off entirely — jog clear of the switch, then switch it back on.',
        goto: 'limits',
        ifNoHoming: true
      }
    ]
  },
  46: {
    title: 'Homing required',
    cause: 'The command needs a homed machine but homing hasn’t been done.',
    recovery: 'Home the machine ($H) first.',
    group: 'motion',
    actions: ['home']
  },
  47: {
    title: 'Tool not set (ATC)',
    cause: 'The current tool is unknown to the automatic tool changer.',
    recovery: 'Set the current tool with M61 Qn.',
    group: 'gcode'
  },
  48: {
    title: 'Value word conflict',
    cause: 'Conflicting value words were given in the block.',
    recovery: 'Remove the conflicting word.',
    group: 'gcode'
  },
  49: {
    title: 'Self-test failed',
    cause: 'The power-on self-test failed; a hard reset is required.',
    recovery: 'Reset the controller. A repeat points to firmware/hardware.',
    group: 'system',
    actions: ['reset']
  },
  50: {
    title: 'Emergency stop active',
    cause: 'The E-stop is asserted.',
    recovery: 'Release the E-stop, then reset.',
    group: 'state',
    actions: ['reset']
  },
  51: {
    title: 'Motor fault',
    cause: 'A motor driver reported a fault.',
    recovery: 'Check driver power/wiring/temperature, then reset.',
    group: 'system',
    actions: ['reset']
  },
  52: {
    title: 'Setting value out of range',
    cause: 'A "$" setting was given a value outside its allowed range.',
    recovery: 'Enter a value within the setting’s range.',
    group: 'system'
  },
  53: {
    title: 'Setting not available',
    cause: 'The setting isn’t available, usually because this driver doesn’t support it.',
    recovery: 'Skip it — this build doesn’t expose that option.',
    group: 'system'
  },
  54: {
    title: 'Retract above drill depth',
    cause: 'In a canned drilling cycle the retract position is below the drill depth.',
    recovery: 'Set the retract (R) plane above the final depth.',
    group: 'gcode'
  },
  55: {
    title: 'Illegal homing configuration',
    cause: 'An attempt was made to home two auto-squared axes at the same time.',
    recovery: 'Put the auto-squared axes in separate homing passes ($44–$47).',
    group: 'motion'
  },
  56: {
    title: 'Coordinate system locked',
    cause: 'The coordinate system is locked and can’t be changed right now.',
    recovery: 'Clear the state that locked it, then retry.',
    group: 'gcode'
  },
  57: {
    title: 'Unexpected file marker',
    cause: 'An unexpected demarcation (%) was found while running a file.',
    recovery: 'Check the program’s start/end markers.',
    group: 'file'
  },
  58: {
    title: 'Aux port unavailable',
    cause: 'The requested auxiliary port doesn’t exist / isn’t available.',
    recovery: 'Use a valid port number for this board.',
    group: 'system'
  },
  60: {
    title: 'SD card mount failed',
    cause: 'The SD card could not be mounted.',
    recovery:
      'Re-seat the card and check it’s FAT32-formatted and wired to the right SPI bus. Reset and retry.',
    group: 'file',
    actions: ['reset']
  },
  61: {
    title: 'File read error',
    cause: 'A read from the SD card / filesystem failed.',
    recovery: 'Re-seat/replace the card, verify the file, and retry.',
    group: 'file'
  },
  62: {
    title: 'Cannot open directory',
    cause: 'The filesystem could not open the requested directory.',
    recovery: 'Check the path exists and the card is mounted.',
    group: 'file'
  },
  63: {
    title: 'Directory not found',
    cause: 'The requested directory does not exist.',
    recovery: 'Use a valid path.',
    group: 'file'
  },
  64: {
    title: 'SD card not mounted',
    cause: 'An SD operation was attempted with no card mounted.',
    recovery: 'Insert/mount a card first.',
    group: 'file'
  },
  65: {
    title: 'Filesystem not mounted',
    cause: 'A file operation was attempted with no filesystem mounted.',
    recovery: 'Mount the filesystem / insert the card first.',
    group: 'file'
  },
  66: {
    title: 'Filesystem read-only',
    cause: 'A write was attempted on a read-only filesystem.',
    recovery: 'Remove write protection, or write to a writable location.',
    group: 'file'
  },
  70: {
    title: 'Bluetooth init failed',
    cause: 'The Bluetooth module failed to initialise.',
    recovery: 'Check the module/wiring and Bluetooth settings, then reset.',
    group: 'system',
    actions: ['reset']
  },
  71: {
    title: 'Unknown expression operator',
    cause: 'An expression (macro) used an operator the parser doesn’t know.',
    recovery: 'Fix the operator in the expression.',
    group: 'macro'
  },
  72: {
    title: 'Divide by zero',
    cause: 'An expression attempted a division by zero.',
    recovery: 'Guard against a zero divisor in the macro.',
    group: 'macro'
  },
  73: {
    title: 'Argument out of range',
    cause: 'An expression argument was too large or too small.',
    recovery: 'Bring the argument into range.',
    group: 'macro'
  },
  74: {
    title: 'Invalid argument',
    cause: 'An argument isn’t valid for that operation.',
    recovery: 'Use a valid argument type/value.',
    group: 'macro'
  },
  75: {
    title: 'Expression syntax error',
    cause: 'An expression is not valid.',
    recovery: 'Correct the expression syntax.',
    group: 'macro'
  },
  76: {
    title: 'Invalid expression result',
    cause: 'The expression produced NaN or infinity.',
    recovery: 'Fix the maths so it yields a finite number.',
    group: 'macro'
  },
  77: {
    title: 'Authentication required',
    cause: 'The action needs authentication first.',
    recovery: 'Authenticate, then retry.',
    group: 'other'
  },
  78: {
    title: 'Access denied',
    cause: 'The action is not permitted for the current session.',
    recovery: 'Use an account/session with the required rights.',
    group: 'other'
  },
  79: {
    title: 'Blocked by critical event',
    cause:
      'A critical event is active — hard limit, soft limit, E-stop, motor fault or an expander fault. grblHAL blocks everything except a soft reset (and read-only $ queries), so $X and $H are refused. This is what a too-early Unlock looks like.',
    recovery: 'Reset the controller, then unlock ($X) and follow the alarm’s own procedure.',
    group: 'state',
    actions: ['reset']
  },
  80: {
    title: 'Flow statement outside macro',
    cause: 'A flow-control statement was used outside a filesystem macro.',
    recovery: 'Only use flow control inside a macro file.',
    group: 'macro'
  },
  81: {
    title: 'Unknown flow statement',
    cause: 'A flow-control statement wasn’t recognised.',
    recovery: 'Fix the flow-control keyword in the macro.',
    group: 'macro'
  },
  82: {
    title: 'Flow stack overflow',
    cause: 'Flow-control nesting overflowed the stack.',
    recovery: 'Reduce nesting/recursion in the macro.',
    group: 'macro'
  },
  83: {
    title: 'Out of memory (macro)',
    cause: 'The controller ran out of memory executing a flow statement.',
    recovery: 'Simplify the macro / reduce its memory use.',
    group: 'macro'
  },
  84: {
    title: 'Could not open file',
    cause: 'The requested file could not be opened.',
    recovery: 'Check the filename/path and that the card is mounted.',
    group: 'file'
  },
  85: {
    title: 'Format failed',
    cause: 'Formatting the filesystem failed.',
    recovery: 'Check/replace the card and retry.',
    group: 'file'
  },
  86: {
    title: 'Aux port not usable',
    cause: 'The auxiliary port exists but can’t be used as requested.',
    recovery: 'Pick a port that supports the function.',
    group: 'system'
  },
  87: {
    title: 'Tool already in spindle',
    cause: 'A tool-change action assumed an empty spindle, but a tool is present.',
    recovery: 'Remove the current tool / correct the tool-change sequence.',
    group: 'gcode'
  },
  88: {
    title: 'No tool in spindle',
    cause: 'A tool-change action expected a tool in the spindle, but there is none.',
    recovery: 'Load the tool / correct the tool-change sequence.',
    group: 'gcode'
  }
}

const ERRORS_SR: Record<number, CodeDetailSR> = {
  1: {
    title: 'G-code reč bez vrednosti',
    cause: 'G-code reč je samo slovo bez broja iza (npr. „X” bez vrednosti).',
    recovery: 'Ispravi liniju — svaka reč traži vrednost. Obično greška CAM-a / post-procesora.'
  },
  2: {
    title: 'Loš format broja',
    cause: 'Numerička vrednost je neispravna ili očekivana vrednost nedostaje.',
    recovery: 'Ispravi broj u toj liniji i pošalji ponovo. Proveri post-procesor ako se ponavlja.'
  },
  3: {
    title: 'Nepoznata $ komanda',
    cause: '„$” sistemska komanda nije prepoznata ili je ovaj build ne podržava.',
    recovery: 'Proveri kucanje komande. Koristi $$ / $HELP da vidiš šta firmware podržava.'
  },
  4: {
    title: 'Negativna vrednost nije dozvoljena',
    cause: 'Zadata je negativna vrednost gde se traži pozitivna.',
    recovery: 'Unesi pozitivnu vrednost.'
  },
  5: {
    title: 'Homing nije omogućen',
    cause: 'Zadata je homing komanda ali je homing isključen u podešavanjima ($22).',
    recovery: 'Omogući homing ($22) i podesi ciklus, ili ne pozivaj $H.'
  },
  6: {
    title: 'Step impuls prekratak',
    cause: 'Vreme step impulsa ($0) je podešeno ispod minimuma (2 µs).',
    recovery: 'Postavi $0 na 2 µs ili više.'
  },
  7: {
    title: 'Čitanje podešavanja neuspešno',
    cause: 'Sačuvano podešavanje nije moglo da se pročita; pogođena podešavanja vraćena na fabrička.',
    recovery: 'Ponovo proveri i sačuvaj podešavanja. Trajni otkaz ukazuje na memorijski čip.'
  },
  8: {
    title: 'Dozvoljeno samo u Idle',
    cause: '„$” komanda je poslata dok mašina nije bila u Idle stanju.',
    recovery: 'Sačekaj da se posao/kretanje završi (stanje = Idle), pa pošalji komandu.'
  },
  9: {
    title: 'Zaključano (alarm/jog)',
    cause: 'G-code je zaključan dok je mašina u alarmu ili jog stanju.',
    recovery: 'Obriši alarm — otključaj ($X) ili homuj ($H) — pre slanja G-code-a.'
  },
  10: {
    title: 'Soft limits traže homing',
    cause: 'Soft limits ($20) se ne mogu omogućiti bez omogućenog homing-a ($22).',
    recovery: 'Prvo omogući homing, ili isključi soft limits.'
  },
  11: {
    title: 'Predugačka linija',
    cause: 'Primljena linija je prekoračila ulazni bafer i nije izvršena.',
    recovery: 'Skrati liniju. Često zalutali znakovi ili problem sa komunikacijom/kodiranjem.'
  },
  12: {
    title: 'Prevelik step rate',
    cause: 'Vrednost podešavanja bi podigla step rate iznad onog što hardver podržava.',
    recovery: 'Smanji korake/mm ($100–$102) ili max brzinu ($110–$112).'
  },
  13: {
    title: 'Safety door otvoren',
    cause: 'Safety door je detektovan kao otvoren pa je ušlo u door (parking) stanje.',
    recovery: 'Zatvori vrata, pa resetuj/nastavi.'
  },
  14: {
    title: 'Startup linija preduga',
    cause: 'Startup linija ($N) ili build-info string je prešao granicu dužine i nije sačuvan.',
    recovery: 'Skrati startup liniju.'
  },
  15: {
    title: 'Jog van hoda',
    cause: 'Jog cilj je van hoda mašine; jog je ignorisan.',
    recovery: 'Joguj manju razdaljinu, ili homuj da soft limits znaju gde si.'
  },
  16: {
    title: 'Loša jog komanda',
    cause: '„$J=” jog komanda nema „=” ili sadrži G-code koji nije dozvoljen u jog-u.',
    recovery: 'Pošalji ispravnu $J= komandu (feed + jedan relativni/apsolutni potez).'
  },
  17: {
    title: 'Laser mod traži PWM',
    cause: 'Laser mod ($32) je uključen ali spindl izlaz nema PWM.',
    recovery: 'Koristi PWM izlaz za spindl ili isključi laser mod.'
  },
  18: {
    title: 'Reset izvršen',
    cause: 'Primljen je soft reset.',
    recovery: 'Normalno posle reseta — nema akcije osim ako je bio neočekivan.'
  },
  19: {
    title: 'Vrednost mora biti pozitivna',
    cause: 'Data je ne-pozitivna vrednost gde se traži pozitivna.',
    recovery: 'Unesi vrednost veću od nule.'
  },
  20: {
    title: 'Nepodržana G-code komanda',
    cause: 'U bloku je nađena nepodržana ili nevažeća G/M komanda.',
    recovery: 'Ukloni ili ispravi komandu. Proveri da post-procesor odgovara grblHAL-u.'
  },
  21: {
    title: 'Sukob modalne grupe',
    cause: 'Dve komande iz iste modalne grupe u jednom bloku (npr. G0 i G1).',
    recovery: 'Razdvoji ih u zasebne linije.'
  },
  22: {
    title: 'Feed rate nije zadat',
    cause: 'Feed potez (G1/G2/G3) je izvršen a feed rate nikad nije zadat.',
    recovery: 'Dodaj F reč pre prvog reznog poteza.'
  },
  23: {
    title: 'Potreban ceo broj',
    cause: 'Komanda koja traži ceo broj dobila je decimalni.',
    recovery: 'Koristi ceo broj za tu reč (npr. broj G/M koda).'
  },
  24: {
    title: 'Sukob axis komandi',
    cause: 'Dve komande koje obe traže axis reči u istom bloku.',
    recovery: 'Stavi ih u zasebne linije.'
  },
  25: {
    title: 'Ponovljena reč',
    cause: 'Ista G-code reč se pojavljuje dvaput u bloku.',
    recovery: 'Ukloni duplu reč.'
  },
  26: {
    title: 'Nema axis reči',
    cause: 'Komandi koja traži axis reči (ili trenutnom modalnom stanju) nijedna nije data.',
    recovery: 'Dodaj axis reč(i) koje komanda zahteva.'
  },
  27: {
    title: 'Nevažeći broj linije',
    cause: 'N broj linije je van važećeg opsega.',
    recovery: 'Koristi važeći broj linije, ili izostavi N numeraciju.'
  },
  28: {
    title: 'Nedostaje value reč',
    cause: 'Komandi nedostaje obavezna value reč (npr. P ili L).',
    recovery: 'Dodaj obaveznu reč za tu komandu.'
  },
  29: {
    title: 'G59.x nije podržan',
    cause: 'Korišćen je G59.1/.2/.3 koordinatni sistem koji ovde nije podržan.',
    recovery: 'Koristi G54–G59, ili omogući proširene WCS u build-u.'
  },
  30: {
    title: 'G53 traži G0/G1',
    cause: 'G53 (mašinske koord.) korišćen sa motion modom koji nije G0 ni G1.',
    recovery: 'Koristi G53 samo sa G0 ili G1.'
  },
  31: {
    title: 'Neočekivane axis reči',
    cause: 'Axis reči u bloku gde ih nijedna komanda ne koristi.',
    recovery: 'Ukloni zalutale axis reči.'
  },
  32: {
    title: 'Luk traži osu u ravni',
    cause: 'G2/G3 luk nema axis reč u aktivnoj ravni.',
    recovery: 'Zadaj krajnju tačku ose u ravni luka.'
  },
  33: {
    title: 'Nevažeći cilj kretanja',
    cause: 'Cilj motion komande je nevažeći (često nemoguć luk).',
    recovery: 'Proveri krajnju tačku i centar/radius luka u toj liniji.'
  },
  34: {
    title: 'Greška radiusa luka',
    cause: 'Luk u radius (R) modu ne može da se izračuna — geometrija se ne zatvara.',
    recovery: 'Ispravi krajnje tačke/radius, ili koristi I/J/K lukove sa centrom.'
  },
  35: {
    title: 'Luk traži offset u ravni',
    cause: 'G2/G3 luku nedostaje I/J/K offset reč u ravni.',
    recovery: 'Dodaj I/J/K offset za aktivnu ravan.'
  },
  36: {
    title: 'Neiskorišćene reči',
    cause: 'Blok sadrži value reči koje nijedna komanda ne koristi.',
    recovery: 'Ukloni suvišne reči.'
  },
  37: {
    title: 'G43.1 pogrešna osa',
    cause: 'Dinamički offset dužine alata (G43.1) primenjen na osu koja nije osa dužine alata.',
    recovery: 'Primeni G43.1 na podešenu osu dužine alata (obično Z).'
  },
  38: {
    title: 'Nevažeći broj alata',
    cause: 'Broj alata je veći od maksimuma, ili je izabran nedefinisan alat.',
    recovery: 'Koristi važeći broj alata / definiši alat.'
  },
  39: {
    title: 'Vrednost van opsega',
    cause: 'Vrednost u bloku je van dozvoljenog opsega.',
    recovery: 'Dovedi vrednost u opseg.'
  },
  40: {
    title: 'Zamena alata na čekanju',
    cause: 'Komanda je poslata dok je ručna zamena alata još u toku.',
    recovery: 'Završi zamenu alata (potvrdi je), pa nastavi.'
  },
  41: {
    title: 'Spindl ne radi',
    cause: 'Kretanje zadato u CSS ili spindle-sync modu dok je spindl zaustavljen.',
    recovery: 'Pokreni spindl pre sinhronizovanog poteza.'
  },
  42: {
    title: 'Nedozvoljena ravan',
    cause: 'Narezivanje navoja zahteva ZX ravan (G18).',
    recovery: 'Izaberi G18 pre ciklusa narezivanja.'
  },
  43: {
    title: 'Prekoračen max feed',
    cause: 'Zadati feed rate je iznad maksimuma ose.',
    recovery: 'Smanji F vrednost ili podigni max brzinu ($110–$112).'
  },
  44: {
    title: 'RPM van opsega',
    cause: 'Zadati RPM spindla je van podešenog min/max ($30/$31).',
    recovery: 'Zadaj RPM u opsegu, ili podesi $30/$31.'
  },
  45: {
    title: 'Limit prekidač aktivan',
    cause:
      'Krajnji prekidač je pritisnut a hard limiti su u strogom režimu ($21 bit 1), pa kontroler prihvata samo homing — ovo je odgovor na $X poslat dok stojiš na prekidaču.',
    recovery:
      'Homuj ($H): homing ignoriše limit ulaze i sam se odveze sa prekidača. Ako homing nije opcija, isključi strogi režim (ili hard limite) u podešavanjima, odjoguj se, pa vrati nazad.',
    steps: [
      'Homuj ($H) — jedino što je dozvoljeno dok je prekidač pritisnut. Homing ignoriše limit ulaze pa sam siđe sa prekidača.',
      'Mašina nema homing? Isključi strogi režim ($21 bit 1) — ili hard limite u celosti — odjoguj se sa prekidača, pa vrati nazad.'
    ]
  },
  46: {
    title: 'Potreban homing',
    cause: 'Komanda traži homovanu mašinu ali homing nije urađen.',
    recovery: 'Prvo homuj mašinu ($H).'
  },
  47: {
    title: 'Alat nije postavljen (ATC)',
    cause: 'Trenutni alat je nepoznat automatskoj zameni alata.',
    recovery: 'Postavi trenutni alat sa M61 Qn.'
  },
  48: {
    title: 'Sukob value reči',
    cause: 'U bloku su date konfliktne value reči.',
    recovery: 'Ukloni konfliktnu reč.'
  },
  49: {
    title: 'Self-test neuspešan',
    cause: 'Power-on self-test nije prošao; potreban je hard reset.',
    recovery: 'Resetuj kontroler. Ponavljanje ukazuje na firmware/hardver.'
  },
  50: {
    title: 'Sigurnosni stop (E-stop) aktivan',
    cause: 'E-stop je aktiviran.',
    recovery: 'Otpusti E-stop, pa resetuj.'
  },
  51: {
    title: 'Kvar motora',
    cause: 'Drajver motora je prijavio kvar.',
    recovery: 'Proveri napajanje/ožičenje/temperaturu drajvera, pa resetuj.'
  },
  52: {
    title: 'Vrednost podešavanja van opsega',
    cause: '„$” podešavanju je data vrednost van dozvoljenog opsega.',
    recovery: 'Unesi vrednost u opsegu podešavanja.'
  },
  53: {
    title: 'Podešavanje nedostupno',
    cause: 'Podešavanje nije dostupno, obično jer ga ovaj drajver ne podržava.',
    recovery: 'Preskoči ga — ovaj build ne izlaže tu opciju.'
  },
  54: {
    title: 'Retract iznad dubine bušenja',
    cause: 'U ciklusu bušenja retract pozicija je ispod dubine bušenja.',
    recovery: 'Postavi retract (R) ravan iznad krajnje dubine.'
  },
  55: {
    title: 'Nedozvoljena homing konfiguracija',
    cause: 'Pokušaj da se dve auto-square ose homuju istovremeno.',
    recovery: 'Stavi auto-square ose u zasebne homing prolaze ($44–$47).'
  },
  56: {
    title: 'Koordinatni sistem zaključan',
    cause: 'Koordinatni sistem je zaključan i ne može se sad menjati.',
    recovery: 'Obriši stanje koje ga je zaključalo, pa ponovi.'
  },
  57: {
    title: 'Neočekivan marker fajla',
    cause: 'Neočekivan „%” marker nađen tokom izvršavanja fajla.',
    recovery: 'Proveri start/end markere programa.'
  },
  58: {
    title: 'Aux port nedostupan',
    cause: 'Traženi pomoćni port ne postoji / nije dostupan.',
    recovery: 'Koristi važeći broj porta za ovu ploču.'
  },
  60: {
    title: 'SD kartica — mount neuspešan',
    cause: 'SD kartica nije mogla da se montira.',
    recovery:
      'Ponovo ubaci karticu, proveri da je FAT32 i povezana na pravu SPI magistralu. Resetuj i ponovi.'
  },
  61: {
    title: 'Greška čitanja fajla',
    cause: 'Čitanje sa SD kartice / fajl sistema nije uspelo.',
    recovery: 'Ponovo ubaci/zameni karticu, proveri fajl i ponovi.'
  },
  62: {
    title: 'Ne mogu otvoriti direktorijum',
    cause: 'Fajl sistem nije mogao da otvori traženi direktorijum.',
    recovery: 'Proveri da putanja postoji i da je kartica montirana.'
  },
  63: {
    title: 'Direktorijum nije nađen',
    cause: 'Traženi direktorijum ne postoji.',
    recovery: 'Koristi važeću putanju.'
  },
  64: {
    title: 'SD kartica nije montirana',
    cause: 'SD operacija pokušana bez montirane kartice.',
    recovery: 'Prvo ubaci/montiraj karticu.'
  },
  65: {
    title: 'Fajl sistem nije montiran',
    cause: 'Fajl operacija pokušana bez montiranog fajl sistema.',
    recovery: 'Montiraj fajl sistem / ubaci karticu.'
  },
  66: {
    title: 'Fajl sistem samo za čitanje',
    cause: 'Pokušan upis na read-only fajl sistem.',
    recovery: 'Ukloni zaštitu od upisa, ili piši na lokaciju sa dozvolom upisa.'
  },
  70: {
    title: 'Bluetooth init neuspešan',
    cause: 'Bluetooth modul nije uspeo da se inicijalizuje.',
    recovery: 'Proveri modul/ožičenje i Bluetooth podešavanja, pa resetuj.'
  },
  71: {
    title: 'Nepoznat operator u izrazu',
    cause: 'Izraz (makro) koristi operator koji parser ne poznaje.',
    recovery: 'Ispravi operator u izrazu.'
  },
  72: {
    title: 'Deljenje nulom',
    cause: 'Izraz je pokušao deljenje nulom.',
    recovery: 'Zaštiti se od nultog delioca u makrou.'
  },
  73: {
    title: 'Argument van opsega',
    cause: 'Argument izraza je prevelik ili premali.',
    recovery: 'Dovedi argument u opseg.'
  },
  74: {
    title: 'Nevažeći argument',
    cause: 'Argument nije važeći za tu operaciju.',
    recovery: 'Koristi važeći tip/vrednost argumenta.'
  },
  75: {
    title: 'Sintaksna greška izraza',
    cause: 'Izraz nije važeći.',
    recovery: 'Ispravi sintaksu izraza.'
  },
  76: {
    title: 'Nevažeći rezultat izraza',
    cause: 'Izraz je dao NaN ili beskonačnost.',
    recovery: 'Ispravi računicu da daje konačan broj.'
  },
  77: {
    title: 'Potrebna autentifikacija',
    cause: 'Akcija prvo zahteva autentifikaciju.',
    recovery: 'Autentifikuj se, pa ponovi.'
  },
  78: {
    title: 'Pristup odbijen',
    cause: 'Akcija nije dozvoljena za trenutnu sesiju.',
    recovery: 'Koristi nalog/sesiju sa potrebnim pravima.'
  },
  79: {
    title: 'Blokirano kritičnim događajem',
    cause:
      'Aktivan je kritičan događaj — hard limit, soft limit, E-stop, kvar motora ili ekspandera. grblHAL blokira sve osim soft reseta (i read-only $ upita), pa $X i $H budu odbijeni. Ovako izgleda prerano otključavanje.',
    recovery: 'Resetuj kontroler, pa otključaj ($X) i prati proceduru samog alarma.'
  },
  80: {
    title: 'Flow naredba van makroa',
    cause: 'Flow-control naredba korišćena van makroa fajl sistema.',
    recovery: 'Koristi flow-control samo unutar makro fajla.'
  },
  81: {
    title: 'Nepoznata flow naredba',
    cause: 'Flow-control naredba nije prepoznata.',
    recovery: 'Ispravi flow-control ključnu reč u makrou.'
  },
  82: {
    title: 'Prekoračenje flow steka',
    cause: 'Ugnežđivanje flow-control-a je prepunilo stek.',
    recovery: 'Smanji ugnežđivanje/rekurziju u makrou.'
  },
  83: {
    title: 'Nedostatak memorije (makro)',
    cause: 'Kontroleru je ponestalo memorije pri izvršavanju flow naredbe.',
    recovery: 'Pojednostavi makro / smanji potrošnju memorije.'
  },
  84: {
    title: 'Ne mogu otvoriti fajl',
    cause: 'Traženi fajl nije mogao da se otvori.',
    recovery: 'Proveri ime/putanju fajla i da je kartica montirana.'
  },
  85: {
    title: 'Formatiranje neuspešno',
    cause: 'Formatiranje fajl sistema nije uspelo.',
    recovery: 'Proveri/zameni karticu i ponovi.'
  },
  86: {
    title: 'Aux port neupotrebljiv',
    cause: 'Pomoćni port postoji ali se ne može koristiti za traženu funkciju.',
    recovery: 'Izaberi port koji podržava tu funkciju.'
  },
  87: {
    title: 'Alat već u spindlu',
    cause: 'Zamena alata je pretpostavila prazan spindl, ali alat je prisutan.',
    recovery: 'Ukloni trenutni alat / ispravi sekvencu zamene alata.'
  },
  88: {
    title: 'Nema alata u spindlu',
    cause: 'Zamena alata je očekivala alat u spindlu, ali ga nema.',
    recovery: 'Ubaci alat / ispravi sekvencu zamene alata.'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookups
// ─────────────────────────────────────────────────────────────────────────────

const UNKNOWN_ALARM: Record<Lang, string> = {
  en: 'Unknown alarm',
  sr: 'Nepoznat alarm'
}
const UNKNOWN_ERROR: Record<Lang, string> = {
  en: 'Unknown error',
  sr: 'Nepoznata greška'
}

export interface ResolvedCode extends CodeDetail {
  code: number
}

/** Merge the EN base with any SR field overrides for the active language. */
function resolve(
  code: number,
  base: Record<number, CodeDetail>,
  sr: Record<number, CodeDetailSR>,
  lang: Lang,
  unknown: string
): ResolvedCode {
  const b = base[code]
  if (!b) {
    return {
      code,
      title: `${unknown} (${code})`,
      cause: '',
      recovery: '',
      group: 'other'
    }
  }
  // the procedure is defined ONCE (in EN); a translation only swaps the wording of
  // each step, position by position, so a missing SR line degrades to the EN text
  // instead of shifting the sequence
  const steps =
    lang === 'sr' && sr[code]?.steps
      ? b.steps?.map((st, i) => ({
          ...st,
          text: sr[code].steps![i] ?? st.text
        }))
      : b.steps
  // badges/buttons always follow the procedure when there is one
  const actions = b.steps
    ? (b.steps
        .map((s) => s.do)
        .filter((d, i, all) => d !== 'manual' && all.indexOf(d) === i) as RecoveryAction[])
    : b.actions
  if (lang === 'sr' && sr[code]) {
    const o = sr[code]
    return {
      code,
      title: o.title ?? b.title,
      cause: o.cause ?? b.cause,
      recovery: o.recovery ?? b.recovery,
      group: b.group,
      steps,
      actions
    }
  }
  return { code, ...b, steps, actions }
}

/** One alarm resolved for `lang` (falls back to EN per field). */
export function getAlarm(code: number, lang: Lang = 'en'): ResolvedCode {
  return resolve(code, ALARMS, ALARMS_SR, lang, UNKNOWN_ALARM[lang])
}

/** One error resolved for `lang` (falls back to EN per field). */
export function getError(code: number, lang: Lang = 'en'): ResolvedCode {
  return resolve(code, ERRORS, ERRORS_SR, lang, UNKNOWN_ERROR[lang])
}

/** All known alarms in `lang`, sorted by code — for the reference list. */
export function listAlarms(lang: Lang = 'en'): ResolvedCode[] {
  return Object.keys(ALARMS)
    .map(Number)
    .sort((a, b) => a - b)
    .map((code) => getAlarm(code, lang))
}

/** All known errors in `lang`, sorted by code — for the reference list. */
export function listErrors(lang: Lang = 'en'): ResolvedCode[] {
  return Object.keys(ERRORS)
    .map(Number)
    .sort((a, b) => a - b)
    .map((code) => getError(code, lang))
}

/** Parse a "ALARM:1" / "error:9" line into its resolved detail, else null. */
export function parseCode(
  line: string,
  lang: Lang = 'en'
): { kind: 'alarm' | 'error'; detail: ResolvedCode } | null {
  const a = /^ALARM:(\d+)/i.exec(line.trim())
  if (a) return { kind: 'alarm', detail: getAlarm(Number(a[1]), lang) }
  const e = /^error:(\d+)/i.exec(line.trim())
  if (e) return { kind: 'error', detail: getError(Number(e[1]), lang) }
  return null
}

/** Parse a line like "ALARM:1" or "error:9" → short "CODE — title" text, else null. */
export function describe(line: string, lang: Lang = 'en'): string | null {
  const parsed = parseCode(line, lang)
  if (!parsed) return null
  const prefix = parsed.kind === 'alarm' ? 'ALARM' : 'error'
  return `${prefix}:${parsed.detail.code} — ${parsed.detail.title}`
}
