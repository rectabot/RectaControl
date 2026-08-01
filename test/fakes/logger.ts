/** Keeps log lines in memory instead of on disk, so a test can assert on them. */
export const logged: string[] = []

export function log(tag: string, msg: string): void {
  logged.push(`${tag}: ${msg}`)
}
