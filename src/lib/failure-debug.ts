import chalk from 'chalk'

const MAXIMUM_DEBUG_FAILURES = 32

export function printFailureDebug(error: unknown, url: string): void {
  process.stderr.write(`\n${chalk.dim('── debug ─────────────────')}\n`)
  if (url) process.stderr.write(`${chalk.dim(`url:   ${url}`)}\n`)
  const seen = new Set<unknown>()
  const pending: Array<{ value: unknown; relation: string }> = [{ value: error, relation: 'error' }]
  while (pending.length > 0 && seen.size < MAXIMUM_DEBUG_FAILURES) {
    const { value, relation } = pending.shift()!
    if (seen.has(value)) continue
    seen.add(value)
    if (!(value instanceof Error)) {
      process.stderr.write(`${chalk.dim(`${relation}: ${String(value)}`)}\n`)
      continue
    }
    process.stderr.write(
      `${chalk.dim(`${relation}: ${value.constructor.name}: ${value.message}`)}\n`,
    )
    if (value.stack) process.stderr.write(`${chalk.dim(value.stack)}\n`)
    if (value.cause !== undefined) pending.push({ value: value.cause, relation: 'caused by' })
    if (value instanceof AggregateError)
      for (const child of value.errors) pending.push({ value: child, relation: 'aggregate' })
  }
}
