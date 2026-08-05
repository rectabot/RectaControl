/**
 * The USB link: which port may be called the board, and what it has to do before the
 * app says it is connected to one.
 *
 * On 5 Aug 2026 Filip switched the machine's power off with the app open on the
 * Ethernet link. The socket dropped, the reconnect chase fell through to USB, and the
 * app reported `connected over usb` — with no USB cable to the board at all, and the
 * board unpowered. It had opened COM1: the motherboard's own Communications Port
 * (ACPI\PNP0501), which opens without complaint and answers nothing, and which the
 * port picker chose because it fell back to "the first port there is". The console
 * then showed a connected machine that would never move again. The log has the same
 * pair — `read ECONNRESET`, then `connected over usb` half a minute later — four
 * times across 3-5 Aug.
 *
 * Two rules, one per section: a port that is not a USB device is not a candidate, and
 * a port that does not answer is not a connection.
 *
 *   npm test      runs this with the rest
 */
import { SerialTransport, pickBoardPort, listPorts } from '../src/main/transport/serial'
import { setPorts, opened, closed } from './fakes/serialport'

let failures = 0
let checks = 0

function ok(cond: boolean, what: string): void {
  checks++
  if (cond) console.log(`  ok   ${what}`)
  else {
    failures++
    console.log(`  FAIL ${what}`)
  }
}
function eq(actual: unknown, expected: unknown, what: string): void {
  ok(actual === expected, `${what} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Filip's PC, exactly as `SerialPort.list()` reports it with nothing plugged in. */
const COM1 = { path: 'COM1', manufacturer: '(Standard port types)', pnpId: 'ACPI\\PNP0501\\0' }
/** The board: an RP2350 CDC device. 2e8a is Raspberry Pi's USB vendor id. */
const BOARD = { path: 'COM7', manufacturer: 'Raspberry Pi', vendorId: '2e8a', productId: '000a', pnpId: 'USB\\VID_2E8A&PID_000A\\E66038B7134B2A2A' }
/** A phone paired over Bluetooth — a serial port by every measure except the one that matters. */
const BT = { path: 'COM5', manufacturer: 'Microsoft', pnpId: 'BTHENUM\\{00001101-0000-1000-8000-00805F9B34FB}_LOCALMFG&0000' }

const probe = { bytes: Buffer.from([0x3f]), timeoutMs: 300, everyMs: 100 }

export async function main(): Promise<number> {
  console.log('\n1. a port that is not a USB device is not a candidate')
  {
    setPorts([COM1])
    eq(await pickBoardPort(), null, 'a PC with only a chipset COM1 has no board on USB')

    setPorts([COM1, BT])
    eq(await pickBoardPort(), null, 'nor does one that also has a Bluetooth pairing')

    setPorts([COM1, BT, BOARD])
    eq(await pickBoardPort(), 'COM7', 'the board is found past both of them, wherever it sits in the list')

    setPorts([BOARD, COM1])
    eq(await pickBoardPort(), 'COM7', 'and is still the board when it happens to be first')

    setPorts([{ path: 'COM9', manufacturer: 'FTDI', vendorId: '0403', productId: '6001', pnpId: 'USB\\VID_0403&PID_6001\\A50285BI' }])
    eq(await pickBoardPort(), 'COM9', 'a board behind some other USB bridge is still worth a try')

    setPorts([COM1])
    const list = await listPorts()
    eq(list[0].usb, false, 'COM1 is reported as what it is')
    setPorts([BOARD])
    eq((await listPorts())[0].usb, true, 'and so is the board')
  }

  console.log('\n2. a port that does not answer is not a connection')
  {
    // COM1 open: the driver is there, the handle is ours, and nothing is on the other
    // end. This is the one the app used to announce as a connected machine.
    setPorts([COM1], { COM1: 'silent' })
    const t = new SerialTransport('COM1', 115200, probe)
    let closes = 0
    t.onClose(() => closes++)
    const started = Date.now()
    const err = await t
      .open()
      .then(() => null)
      .catch((e: Error) => e)

    ok(err !== null, 'open() rejected instead of reporting a connection')
    ok(/did not answer/.test(String(err?.message ?? '')), 'and said why, in words that name the remedy')
    ok(opened.includes('COM1'), 'the port really was opened — this is not a failure to open')
    ok(closed.includes('COM1'), 'and it was released again, not left held')
    eq(t.isOpen, false, 'the transport is not open')
    ok(Date.now() - started >= probe.timeoutMs, 'it waited out the probation before saying so')
    await wait(50)
    eq(closes, 0, 'and nothing was reported as a link that dropped — there was no link')
  }

  console.log('\n3. a board that answers is a connection, and its first words are not lost')
  {
    setPorts([BOARD], { COM7: 'answers' })
    const t = new SerialTransport('COM7', 115200, probe)
    const seen: string[] = []
    t.onData((c) => seen.push(c.toString()))
    const started = Date.now()
    await t.open()

    eq(t.isOpen, true, 'the transport is open')
    ok(Date.now() - started < probe.timeoutMs, `a board that speaks is accepted at once, not after the full wait (${Date.now() - started} ms)`)
    eq(seen.length, 0, 'nothing was handed up before the caller was told there is a connection')
    await wait(20)
    ok(seen.join('').includes('<Idle'), "the board's answer was held during probation and delivered, not swallowed")
    await t.close()
  }

  console.log('\n4. opening blind is still possible — the probe is the caller’s choice')
  {
    // The rescue path reaches a board that never answered anything; requiring an answer
    // there would refuse the one case it exists for.
    setPorts([COM1], { COM1: 'silent' })
    const t = new SerialTransport('COM1', 115200)
    await t.open()
    eq(t.isOpen, true, 'no probe, no probation')
    await t.close()
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  return failures
}
