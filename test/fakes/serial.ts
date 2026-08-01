/** Stands in for the real serial port. Records everything the controller writes
 *  and lets a test feed replies back as if the board had sent them. */
export class SerialTransport {
  isOpen = false
  /** every command line written, newline stripped */
  lines: string[] = []
  /** every realtime byte written (`?`, feed hold, reset, …) */
  realtime: number[] = []
  private dataCb: (chunk: Buffer) => void = () => {}
  private closeCb: (reason?: string) => void = () => {}

  constructor(_port: string, _baud: number) {
    last = this
  }
  async open(): Promise<void> {
    this.isOpen = true
  }
  async close(): Promise<void> {
    this.isOpen = false
    this.closeCb('closed')
  }
  write(data: Buffer | string): void {
    if (typeof data === 'string') this.lines.push(data.replace(/\n$/, ''))
    else for (const b of data) this.realtime.push(b)
  }
  onData(cb: (chunk: Buffer) => void): void {
    this.dataCb = cb
  }
  onClose(cb: (reason?: string) => void): void {
    this.closeCb = cb
  }
  /** push one reply line from the "board" */
  feed(line: string): void {
    this.dataCb(Buffer.from(line + '\n'))
  }
}

/** the instance the controller built on its last connect() */
export let last: SerialTransport | null = null

export function pickBoardPort(): string | null {
  return null
}
