/**
 * Argv redaction for telemetry: strips secret-looking values before an
 * invocation is recorded, then bounds per-arg length and array size. Pure —
 * no fs, no env, safe to call from any path.
 */

const SECRET_KEY = /(token|secret|key|password|auth|bearer|jwk|credential)/i
const REDACTED = '<redacted>'
const MAX_ARG_LEN = 200
const MAX_ITEMS = 40

/** Redact secret values in argv, truncate long args, cap the array length. */
export function redactArgv(argv: string[]): string[] {
  const out: string[] = []
  let redactNext = false
  for (const arg of argv) {
    if (redactNext) {
      out.push(REDACTED)
      redactNext = false
      continue
    }
    const eq = arg.indexOf('=')
    if (eq > 0 && SECRET_KEY.test(arg.slice(0, eq).replace(/^-+/, ''))) {
      out.push(arg.slice(0, eq + 1) + REDACTED)
      continue
    }
    if (eq < 0 && arg.startsWith('-') && SECRET_KEY.test(arg.replace(/^-+/, ''))) {
      out.push(arg)
      redactNext = true
      continue
    }
    out.push(arg)
  }
  const bounded = out.map((a) => (a.length > MAX_ARG_LEN ? a.slice(0, MAX_ARG_LEN) + '…' : a))
  if (bounded.length > MAX_ITEMS) {
    return [...bounded.slice(0, MAX_ITEMS), `…+${bounded.length - MAX_ITEMS}`]
  }
  return bounded
}
