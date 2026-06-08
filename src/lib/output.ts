import chalk from 'chalk'
import { stringify as yamlStringify } from 'yaml'

import { renderTable, type Column } from './table'

export type { Column } from './table'

export type OutputOpts = {
  raw?: boolean
  json?: boolean
  format?: 'yaml' | 'json'
}

export type RawOutputOpts = Pick<OutputOpts, 'raw' | 'json'>

export const RAW_OUTPUT_OPTIONS = [
  { flags: '--json', description: 'Always-valid JSON (for jq)' },
  { flags: '--raw', description: 'Unwrapped: bare scalar / raw bytes / JSON for objects' },
] as const

/**
 * Is the consumer a machine (emit structured data, not a pretty view)?
 * True for `--json`, `--raw`, or any non-TTY stdout (pipe, redirect, CI, agent).
 */
export function isMachine(opts?: RawOutputOpts): boolean {
  return !!(opts?.raw || opts?.json) || !(process.stdout.isTTY ?? false)
}

/**
 * `--raw` = the *unwrapped* value (bare scalar, raw bytes). The raw-vs-json
 * distinction only manifests for scalars and binary; objects/arrays fall back
 * to JSON under either flag.
 */
export function isUnwrapped(opts?: RawOutputOpts): boolean {
  return !!opts?.raw
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

// ── present: shape-aware rendering ──────────────────────────

export type PresentOpts = OutputOpts & { denoise?: boolean }

/** One display row per item plus the columns and (optional) `-q` paths. */
export type ListProjection = {
  columns: Column[]
  rows: Array<Record<string, string>>
  paths?: string[]
}

export type ListOpts = OutputOpts & {
  quiet?: boolean
  count?: boolean
  long?: boolean
}

const NOISE_KEYS = new Set(['schema', 'icon', 'code', 'inputSchema', 'outputSchema'])

/**
 * Strip heavy, low-signal keys (serialized schema blobs, SVG icons, code) at any
 * depth — so machine output is the kernel's data minus the noise, never a wall.
 */
export function denoise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(denoise)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (NOISE_KEYS.has(k)) continue
      out[k] = v && typeof v === 'object' ? denoise(v) : v
    }
    return out
  }
  return value
}

function isBareScalar(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

/**
 * Present a single kernel value, shape- and audience-aware.
 *
 * - scalar → `--raw` bare (no quotes, for `X=$(…)`) · `--json`/pipe JSON · TTY bare
 * - object → YAML on a TTY, JSON for machines (delegates to {@link output})
 * - array  → YAML/JSON fallback (use {@link presentList} for a table)
 *
 * `null`/`undefined` normalize to `null` (via `output`) so `JSON.parse(stdout)`
 * never breaks.
 */
export function present(value: unknown, opts: PresentOpts = {}): void {
  const data = opts.denoise ? denoise(value) : value

  if (isBareScalar(data)) {
    if (opts.raw) {
      process.stdout.write(String(data) + '\n')
      return
    }
    if (!opts.json && (process.stdout.isTTY ?? false)) {
      process.stdout.write(String(data) + '\n')
      return
    }
    // `--json` or non-TTY machine → JSON (quoted string / bare number).
  }

  output(data, opts)
}

/**
 * Present an array of objects.
 *
 * - `--count`     → just the number
 * - `-q/--quiet`  → one path per line (unix-pipeable)
 * - machine       → denoised JSON of the raw items (`-l` keeps full items)
 * - TTY           → an aligned table + a dim count footer
 *
 * Projection (columns/rows/paths) is for the human table and `-q` only; the
 * machine surface stays the kernel's own item fields.
 */
export function presentList<T>(
  items: T[],
  opts: ListOpts,
  project: (items: T[]) => ListProjection,
): void {
  if (opts.count) {
    process.stdout.write(String(items.length) + '\n')
    return
  }

  if (opts.quiet) {
    const proj = project(items)
    const paths = proj.paths ?? proj.rows.map((r) => r[proj.columns[0]?.key ?? ''] ?? '')
    for (const p of paths) process.stdout.write(p + '\n')
    return
  }

  if (isMachine(opts) || opts.format) {
    output(opts.long ? items : denoise(items), opts)
    return
  }

  const proj = project(items)
  const table = renderTable(proj.rows, { columns: proj.columns })
  const footer =
    items.length > 0 ? chalk.dim(`\n  ${items.length} item${items.length === 1 ? '' : 's'}`) : ''
  process.stdout.write(table + footer + '\n')
}
