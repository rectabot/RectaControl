/** Common transport interface for the two ways to reach the board. */

export interface Transport {
  open(): Promise<void>
  close(): Promise<void>
  write(data: Buffer | string): void
  readonly isOpen: boolean
  onData(cb: (chunk: Buffer) => void): void
  onClose(cb: (reason?: string) => void): void
}
