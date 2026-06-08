import chalk from 'chalk'
import { stringify as yamlStringify } from 'yaml'

export type OutputOpts = {
  raw?: boolean
  json?: boolean
  format?: 'yaml' | 'json'
}

export type RawOutputOpts = Pick<OutputOpts, 'raw' | 'json'>

export const RAW_OUTPUT_OPTIONS = [
  { flags: '--raw', description: 'Output raw JSON (no colors)' },
  { flags: '--json', description: 'Alias for --raw' },
] as const

/**
 * Determine if output should be raw (machine-readable).
 */
export function isRawOutput(opts?: RawOutputOpts): boolean {
  return !!(opts?.raw || opts?.json) || !(process.stdout.isTTY ?? false)
}

/**
 * Write structured data to stdout in the appropriate format.
 *
 * Precedence:
 * - `--raw` / `--json` → plain JSON, no colors (machine-readable)
 * - explicit `--format yaml|json` → honor regardless of TTY, colors only on TTY
 * - default on TTY → highlighted YAML
 * - default on non-TTY → plain JSON
 *
 * Void-returning syscalls surface as `undefined` here; `JSON.stringify(undefined)`
 * itself returns `undefined`, which would print the bare string `undefined` and
 * break any caller doing `JSON.parse(stdout)`. Normalize to `null` (parseable
 * JSON, valid YAML) at the entry so every formatter branch is consistent.
 */
export function output(data: unknown, opts: OutputOpts): void {
  if (data === undefined) data = null

  if (opts.raw || opts.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
    return
  }

  const isTTY = process.stdout.isTTY ?? false

  if (opts.format === 'json') {
    const rendered = isTTY ? highlightJson(data) : JSON.stringify(data, null, 2)
    process.stdout.write(rendered + '\n')
    return
  }

  if (opts.format === 'yaml') {
    const rendered = isTTY
      ? highlightYaml(data)
      : yamlStringify(data, { indent: 2, lineWidth: 120 }).trimEnd()
    process.stdout.write(rendered + '\n')
    return
  }

  // Default: TTY → highlighted YAML, non-TTY → plain JSON
  if (isTTY) {
    process.stdout.write(highlightYaml(data) + '\n')
  } else {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  }
}

// ── YAML ───────────────────────────────────────────────────

function highlightYaml(data: unknown): string {
  const raw = yamlStringify(data, { indent: 2, lineWidth: 120 })
  return raw
    .replace(
      /^(\s*-?\s*)([\w.-]+)(:)\s*(.*)/gm,
      (_, indent: string, key: string, colon: string, value: string) =>
        `${indent}${chalk.cyan(key)}${colon} ${colorYamlValue(value)}`,
    )
    .trimEnd()
}

function colorYamlValue(value: string): string {
  if (value === 'null' || value === '~') return chalk.dim('null')
  if (value === 'true' || value === 'false') return chalk.magenta(value)
  if (/^-?\d+(\.\d+)?$/.test(value)) return chalk.yellow(value)
  return chalk.green(value)
}

// ── JSON ───────────────────────────────────────────────────

function highlightJson(data: unknown): string {
  const json = JSON.stringify(data, null, 2)
  return json
    .replace(/"([^"]+)"(?=\s*:)/g, (_, key: string) => chalk.cyan(`"${key}"`))
    .replace(/: "([^"]*)"(?=[,\n\r\]}])/g, (_, val: string) => `: ${chalk.green(`"${val}"`)}`)
    .replace(/: (-?\d+\.?\d*(?:e[+-]?\d+)?)\b/gi, (_, num: string) => `: ${chalk.yellow(num)}`)
    .replace(/: (true|false)\b/g, (_, bool: string) => `: ${chalk.magenta(bool)}`)
    .replace(/: (null)\b/g, () => `: ${chalk.dim('null')}`)
}
