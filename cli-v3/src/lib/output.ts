import chalk from 'chalk'
import { stringify as yamlStringify } from 'yaml'

export type OutputOpts = {
  raw?: boolean
  json?: boolean
  format?: 'yaml' | 'json'
}

/**
 * Write structured data to stdout in the appropriate format.
 *
 * - `--raw` / `--json` / non-TTY → raw JSON (machine-readable)
 * - `--format json` → highlighted JSON
 * - default (TTY) → highlighted YAML
 */
export function output(data: unknown, opts: OutputOpts): void {
  if (opts.raw || opts.json || !process.stdout.isTTY) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
    return
  }
  const format = opts.format ?? 'yaml'
  console.log(format === 'json' ? highlightJson(data) : highlightYaml(data))
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
