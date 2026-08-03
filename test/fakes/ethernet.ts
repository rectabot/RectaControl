/** Stands in for the TCP socket so the controller's connection lifecycle can be driven
 *  without a board. The transport itself is tested for real, against a local server, in
 *  link.test.ts — here we only care about how many sockets the controller decides to
 *  open, and to which board. */
export const opened: EthernetTransport[] = []

export class EthernetTransport {
  isOpen = false
  constructor(
    public host: string,
    public port: number
  ) {}
  async open(): Promise<void> {
    this.isOpen = true
    opened.push(this)
  }
  async close(): Promise<void> {
    this.isOpen = false
    this.closeCb('connection closed') // a real socket reports its own closing
  }
  write(): void {}
  onData(): void {}
  private closeCb: (reason?: string) => void = () => {}
  onClose(cb: (reason?: string) => void): void {
    this.closeCb = cb
  }
}
