/** Never used by these tests — the controller only imports it. */
export class EthernetTransport {
  isOpen = false
  async open(): Promise<void> {}
  async close(): Promise<void> {}
  write(): void {}
  onData(): void {}
  onClose(): void {}
}
