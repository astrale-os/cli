// ESC[…m — built without a control char in the source so no lint disable is needed.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/** Drop every SGR escape, leaving what the terminal actually prints. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI, '')
}

/** Printable width of a string, ignoring ANSI color codes. */
export function visibleWidth(s: string): number {
  return stripAnsi(s).length
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}
