/** Rescue byte pairs — the way back into a board the parser cannot be reached on.
 *
 *  A controller that boots, greets, and then ignores `$I`, `$$`, `$X` and even a bare
 *  newline is not a dead board: grblHAL suspends the line parser in some states (a
 *  safety door it believes is ajar is the one that bit us on 29 Jul 2026), while
 *  realtime bytes are still handled the moment they land, in the receive interrupt.
 *  These two pairs live there, so they work when nothing else does — including when
 *  `$UF2` comes back as error:79, or comes back as nothing at all.
 *
 *  Requires firmware built on or after 30 Jul 2026. Older boards ignore the bytes
 *  entirely, which is the safe direction: nothing happens, and the operator is no
 *  worse off than before.
 *
 *  The prefix is deliberately doubled and expires after 250 ms on the board — see
 *  driver.c. Send the three bytes together and do not pace them.
 */

import { SerialPort } from 'serialport'

/** Arms the sequence; on its own it does nothing. */
const PREFIX = 0x8d

export const RESCUE = {
  /** Reboot into the UF2 bootloader. USB only — the bootloader has no network. */
  bootsel: Buffer.from([PREFIX, PREFIX, 0x8e]),
  /** Erase settings, then reboot. Works over USB and Ethernet alike. */
  wipe: Buffer.from([PREFIX, PREFIX, 0x8f])
} as const

export type RescueAction = keyof typeof RESCUE

/** Send a pair straight at a serial port, without connecting to the board first.
 *
 *  For the case the connected path cannot cover: a board that never answered, so
 *  there is no session to send through. grblHAL does not have to reply — or even to
 *  be listening at the protocol level — for the bytes to reach the interrupt that
 *  handles them.
 *
 *  DTR and RTS are raised because .NET-style defaults leave them low and USB CDC
 *  then behaves as though no host were attached: bytes go nowhere and nothing says
 *  so. That cost an afternoon on 30 Jul, where a test reported four clean passes
 *  that had never actually been sent.
 */
export function sendBlind(portPath: string, action: RescueAction, baud = 115200): Promise<void> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path: portPath, baudRate: baud }, (err) => {
      if (err) return reject(err)
      port.set({ dtr: true, rts: true }, () => {
        port.write(RESCUE[action], (werr) => {
          if (werr) {
            port.close(() => reject(werr))
            return
          }
          // Drain before closing: the board reboots on receipt, and closing the
          // port with bytes still buffered loses the very thing we came to send.
          port.drain(() => {
            // No reply is expected and none is waited for — a wipe reboots the
            // board and a bootsel takes the USB device away with it.
            port.close(() => resolve())
          })
        })
      })
    })
  })
}
