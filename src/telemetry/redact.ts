/**
 * Argv redaction for telemetry: strips secret-looking values before an
 * invocation is recorded, then bounds per-arg length and array size. Pure —
 * no fs, no env, safe to call from any path.
 */

const SECRET_KEY = /(token|secret|key|password|auth|bearer|jwk|credential)/i
// Secret-shaped VALUES regardless of the key they travel under: JWTs (the
// `eyJ` base64 of `{"`) and provider API keys. Deliberately no generic
// long-base64 rule — absolute paths share that alphabet and would false-hit.
const SECRET_VALUE_SHAPES = [
  /eyJ[A-Za-z0-9_-]{14,}(?:\.[A-Za-z0-9_-]{8,}){0,2}/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
]
const REDACTED = '<redacted>'
const MAX_ARG_LEN = 200
const MAX_ITEMS = 40

/** Replace secret-shaped substrings anywhere in an arg (positional JWTs etc.). */
function redactValueShapes(arg: string): string {
  let out = arg
  for (const shape of SECRET_VALUE_SHAPES) out = out.replace(shape, REDACTED)
  return out
}

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
    out.push(redactValueShapes(arg))
  }
  const bounded = out.map((a) => (a.length > MAX_ARG_LEN ? a.slice(0, MAX_ARG_LEN) + '…' : a))
  if (bounded.length > MAX_ITEMS) {
    return [...bounded.slice(0, MAX_ITEMS), `…+${bounded.length - MAX_ITEMS}`]
  }
  return bounded
}
