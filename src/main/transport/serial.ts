/** USB CDC transport via the serialport package. */

import { SerialPort } from 'serialport'
import type { Transport } from './index'
import type { SerialPortInfo } from '@shared/types'

/** Raspberry Pi's USB vendor id. Every RP2040/RP2350 CDC device carries it, so the
 *  board identifies itself before a single byte is exchanged. */
const RP_VID = '2e8a'

/** Second-best evidence, for a board behind a different USB-serial bridge. */
const NAME_HINT = /pico|rp2|raspberry|grbl|cdc|usb serial|wch|board/i

export async function listPorts(): Promise<SerialPortInfo[]> {
  const ports = await SerialPort.list()
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer,
    vendorId: p.vendorId,
    productId: p.productId,
    // Only USB enumeration fills vendor/product ids. A legacy chipset port
    // (ACPI\PNP0501) and a Bluetooth SPP port (BTHENUM\…) have neither.
    usb: !!p.vendorId || /^USB\\/i.test(p.pnpId ?? '')
  }))
}

/** The port most likely to be the board: an RP2350 enumerates as a Raspberry Pi /
 *  Pico CDC device. Used by auto-connect and by the rescue path, which has to reach a
 *  board that never answered and so cannot be identified by talking to it.
 *
 *  It will NOT return a port that is not a USB device, and that restriction is the
 *  whole point. This used to fall back to "the first port there is", and on Filip's PC
 *  the first port there is is COM1 — the motherboard's Communications Port, ACPI\
 *  PNP0501, with nothing on the other end of it. It opens perfectly happily. So when
 *  the board's power went off on 5 Aug 2026, the Ethernet link dropped, the reconnect
 *  chase fell through to USB, and the app announced `connected over usb` against an
 *  empty chipset UART — with the machine switched off. The log has it four times in
 *  two days, each one about half a minute after a `read ECONNRESET`.
 *
 *  A board is a USB device. Nothing that is not one is a candidate, and returning null
 *  (there is no board on USB) is the honest answer this had no way to give. */
export async function pickBoardPort(): Promise<string | null> {
  const usb = (await listPorts()).filter((p) => p.usb)
  if (!usb.length) return null
  const pick =
    usb.find((p) => p.vendorId?.toLowerCase() === RP_VID) ??
    usb.find((p) => NAME_HINT.test(`${p.manufacturer ?? ''} ${p.path}`)) ??
    usb[0]
  return pick.path
}

/** What an opened port has to do before it is called a connection.
 *
 *  The protocol lives with the caller, not here — the transport only knows that it
 *  writes `bytes`, and that something has to come back. See USB_PROBE in controller.ts
 *  for the question it actually asks and why that one. */
export interface SerialProbe {
  bytes: Buffer
  /** Silence for this long means the far end is not the board. */
  timeoutMs: number
  /** Ask again this often while waiting — one lost byte must not condemn a board. */
  everyMs: number
}

export class SerialTransport implements Transport {
  private port: SerialPort | null = null
  private dataCb: (chunk: Buffer) => void = () => {}
  private closeCb: (reason?: string) => void = () => {}

  constructor(
    private path: string,
    private baud = 115200,
    /** When set, the port must answer before open() resolves. Null opens blind. */
    private probe: SerialProbe | null = null
  ) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = new SerialPort({ path: this.path, baudRate: this.baud }, (err) => {
        if (err) {
          this.port = null
          reject(err)
          return
        }
        this.port = port
        if (!this.probe) {
          this.live(port)
          resolve()
          return
        }

        // Probation — the serial half of what ethernet.ts does at the socket. Opening
        // a serial port proves the OS has a driver for it and nothing whatsoever about
        // what is on the far end: a bare chipset UART opens, accepts every byte written
        // to it, and never says a word. That is not a failure the app can see later,
        // either — it looks exactly like a connected machine that happens to be quiet.
        //
        // So ask, and require an answer. Anything the board sends meanwhile is held
        // rather than forwarded (the greeting is the usual case) and flushed in order
        // once the caller has been told there is a connection — same ordering as
        // Ethernet, for the same reason.
        let settled = false
        const held: Buffer[] = []

        const accept = (): void => {
          if (settled) return
          settled = true
          clearInterval(poke)
          clearTimeout(deadline)
          port.removeListener('data', onEarly)
          port.removeListener('close', onClosed)
          port.removeListener('error', onErrored)
          this.live(port)
          resolve()
          setImmediate(() => held.forEach((c) => this.dataCb(c)))
        }

        // Nothing came back. Close the port rather than leave it held open — this app
        // is not the only thing that may want it, and a port we have decided is not the
        // board must not be sitting in our hand. Deliberately does NOT run the close
        // callback: nobody was ever told this was a connection, and reporting a
        // disconnect from a connection that never existed is how the console fills with
        // events the operator cannot place.
        const giveUp = (why: string): void => {
          if (settled) return
          settled = true
          clearInterval(poke)
          clearTimeout(deadline)
          this.port = null
          port.removeListener('data', onEarly)
          port.removeListener('close', onClosed)
          port.removeListener('error', onErrored)
          // Not removeAllListeners: a serial port is a stream, and a stream that emits
          // 'error' with nobody listening THROWS — out of a timer callback, in the main
          // process, which takes the app with it. Letting a port go is exactly when one
          // is most likely to complain, so leave an ear on it that does nothing.
          port.on('error', () => {})
          try {
            if (port.isOpen) port.close(() => {})
          } catch {
            /* already gone — nothing to release */
          }
          reject(new Error(why))
        }

        const onEarly = (chunk: Buffer): void => {
          held.push(chunk)
          accept()
        }
        const onClosed = (): void => giveUp(`${this.path} closed before it answered`)
        const onErrored = (e: Error): void => giveUp(e.message)

        port.on('data', onEarly)
        port.once('close', onClosed)
        port.once('error', onErrored)

        port.write(this.probe.bytes)
        const poke = setInterval(() => port.write(this.probe!.bytes), this.probe.everyMs)
        const deadline = setTimeout(
          () =>
            giveUp(
              `${this.path} did not answer — the port opens but nothing on it replies, so this is not the board (check the USB cable, or pick the port by hand)`
            ),
          this.probe.timeoutMs
        )
      })
    })
  }

  /** Hand the port over to the owner: from here on data and closure are theirs. */
  private live(port: SerialPort): void {
    port.on('data', (chunk: Buffer) => this.dataCb(chunk))
    port.on('close', () => this.closeCb('port closed'))
    port.on('error', (e) => this.closeCb(e.message))
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port) return resolve()
      this.port.close(() => {
        this.port = null
        resolve()
      })
    })
  }

  write(data: Buffer | string): void {
    this.port?.write(data)
  }

  get isOpen(): boolean {
    return !!this.port?.isOpen
  }

  onData(cb: (chunk: Buffer) => void): void {
    this.dataCb = cb
  }

  onClose(cb: (reason?: string) => void): void {
    this.closeCb = cb
  }
}
