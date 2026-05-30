/**
 * Core logic for `astrale env check` — audits each domain's env hygiene
 * without touching the kernel or any network. Kept as pure, side-effect-
 * free functions (the command layer in `commands/env/check.ts` does the
 * discovery, printing, and exit-code).
 *
 * Checks per domain:
 *   (a) `.env.example` lists every key in `requiredSecrets ∪ forwardEnv`.
 *   (b) `extraDevVars` does not overlap `forwardEnv`/`forwardEnvOptional`
 *       (delegated to the existing `assertNoDevVarsKeyOverlap`).
 *   (c) topology leaks: no `_BASE_DOMAIN` literal in `extraDevVars` keys,
 *       and no soft-fallback (`?? '…'` / `|| '…'`) on a `*_BASE_DOMAIN`
 *       in a schema file (those must hard-throw).
 *   (d) committed secrets: a real secret VALUE in a wrangler config or
 *       `.env.example` (live keys → ERROR, test keys → WARNING).
 */

import type { LifecycleConfig } from '@astrale-os/kernel-host'

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { assertNoDevVarsKeyOverlap } from '../adapters/domain-platform/cloudflare-helpers'
import { AstraleError, LifecycleConfigInvalidError } from '../errors'

export type Severity = 'error' | 'warning'

export type Finding = {
  severity: Severity
  /** Short machine-readable check id, e.g. `env-example`, `secret-leak`. */
  check: string
  message: string
}

export type DomainReport = {
  /** Absolute path to the domain directory. */
  dir: string
  /** Domain slug (label). */
  slug: string
  findings: Finding[]
  /** Keys appended to `.env.example` by `--fix-example` (if any). */
  fixed?: string[]
}

export type EnvCheckOptions = {
  /** Append missing keys to `.env.example` instead of only reporting them. */
  fixExample?: boolean
}

const err = (check: string, message: string): Finding => ({ severity: 'error', check, message })
const warn = (check: string, message: string): Finding => ({ severity: 'warning', check, message })

/** A report has at least one ERROR finding. */
export function hasError(report: DomainReport): boolean {
  return report.findings.some((f) => f.severity === 'error')
}

/** Any report across the run carries an ERROR (→ process should exit non-zero). */
export function anyError(reports: readonly DomainReport[]): boolean {
  return reports.some(hasError)
}

// ── (a) .env.example completeness ─────────────────────────────────────

/**
 * Keys that MUST appear in `.env.example`: the union of `requiredSecrets`
 * and `forwardEnv` (the strict-forward list). `forwardEnvOptional` is
 * deliberately excluded — those are optional and the worker bakes in a
 * default, so they need not be documented as required.
 */
export function requiredEnvKeys(config: LifecycleConfig): string[] {
  return [...new Set([...(config.requiredSecrets ?? []), ...(config.forwardEnv ?? [])])]
}

/** Names already present (as `NAME=` or `NAME =`) in `.env.example` text. */
function envExampleKeys(text: string): Set<string> {
  const keys = new Set<string>()
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    if (m) keys.add(m[1])
  }
  return keys
}

/** Block appended to `.env.example` for a missing required key. */
function fixBlock(name: string): string {
  return `# ${name} (required secret)\n${name}=\n`
}

/**
 * Check (a). When `fixExample` is set and keys are missing, append them to
 * `.env.example` (creating the file if absent) and record them in
 * `report.fixed` instead of erroring. Existing content is never clobbered.
 */
function checkEnvExample(
  report: DomainReport,
  config: LifecycleConfig,
  opts: EnvCheckOptions,
): void {
  const required = requiredEnvKeys(config)
  if (required.length === 0) return

  const path = join(report.dir, '.env.example')
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  const present = envExampleKeys(existing)
  const missing = required.filter((k) => !present.has(k))
  if (missing.length === 0) return

  if (opts.fixExample) {
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
    const appended = prefix + missing.map(fixBlock).join('')
    writeFileSync(path, existing + appended)
    report.fixed = [...(report.fixed ?? []), ...missing]
    return
  }

  report.findings.push(
    err(
      'env-example',
      `.env.example is missing required key(s): ${missing.join(', ')} ` +
        `(re-run with --fix-example to append them)`,
    ),
  )
}

// ── (b) extraDevVars ↔ forward overlap ────────────────────────────────

function checkDevVarsOverlap(
  report: DomainReport,
  config: LifecycleConfig,
  lifecyclePath?: string,
): void {
  try {
    assertNoDevVarsKeyOverlap(config, report.slug, lifecyclePath)
  } catch (e) {
    if (e instanceof LifecycleConfigInvalidError) {
      report.findings.push(err('devvars-overlap', e.message))
      return
    }
    throw e
  }
}

// ── (c) topology leaks ────────────────────────────────────────────────

const BASE_DOMAIN_KEY = /_BASE_DOMAIN$/
// A `*_BASE_DOMAIN` reference followed (on the same line) by a soft-fallback
// to a string literal — the anti-pattern: schemas must hard-throw, not fall
// back to a host literal.
const SOFT_FALLBACK = /_BASE_DOMAIN[^=\n]*(\?\?|\|\|)\s*['"][^'"]+['"]/

/** (c1) Any `extraDevVars` key matching `*_BASE_DOMAIN`. */
function checkExtraDevVarsBaseDomain(report: DomainReport, config: LifecycleConfig): void {
  const offenders = Object.keys(config.extraDevVars ?? {}).filter((k) => BASE_DOMAIN_KEY.test(k))
  if (offenders.length === 0) return
  report.findings.push(
    err(
      'basedomain-literal',
      `extraDevVars contains base-domain key(s): ${offenders.join(', ')} ` +
        `(base domains must come from the topology resolver, never a literal)`,
    ),
  )
}

/** (c2) Soft-fallback on a `*_BASE_DOMAIN` in any `schema/**\/*.ts` file. */
async function checkSchemaSoftFallback(report: DomainReport): Promise<void> {
  const schemaDir = join(report.dir, 'schema')
  if (!existsSync(schemaDir)) return
  for (const file of await listTsFiles(schemaDir)) {
    const text = readFileSync(file, 'utf-8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (SOFT_FALLBACK.test(line)) {
        report.findings.push(
          err(
            'basedomain-fallback',
            `${relative(report.dir, file)}:${i + 1} soft-fallback on a *_BASE_DOMAIN ` +
              `(schemas must hard-throw, not fall back to a host literal)`,
          ),
        )
      }
    })
  }
}

// ── (d) committed-secret scan ─────────────────────────────────────────

type SecretMarker = { needle: string; severity: Severity; label: string }

/**
 * Secret VALUE markers. `sk_test_` is the only allowlisted (test-tier)
 * one → WARNING; everything else is an ERROR. `"d":` is the RFC 7517 JWK
 * private-key parameter — its presence in a committed config means a raw
 * private key got checked in.
 */
const SECRET_MARKERS: SecretMarker[] = [
  { needle: 'sk_live_', severity: 'error', label: 'live Stripe key' },
  { needle: 'gho_', severity: 'error', label: 'GitHub OAuth token' },
  { needle: '"d":', severity: 'error', label: 'JWK private key' },
  { needle: 'sk_test_', severity: 'warning', label: 'test Stripe key' },
]

/** Files (relative to the domain dir) scanned for committed secret values. */
function secretScanTargets(dir: string): string[] {
  const candidates = [
    'wrangler.toml',
    'wrangler.jsonc',
    'worker/wrangler.toml',
    'worker/wrangler.jsonc',
    '.env.example',
  ]
  return candidates.map((c) => join(dir, c)).filter((p) => existsSync(p))
}

function checkCommittedSecrets(report: DomainReport): void {
  for (const file of secretScanTargets(report.dir)) {
    const lines = readFileSync(file, 'utf-8').split('\n')
    lines.forEach((line, i) => {
      for (const marker of SECRET_MARKERS) {
        if (!line.includes(marker.needle)) continue
        const where = `${relative(report.dir, file)}:${i + 1}`
        const msg = `${where} contains a ${marker.label} value (\`${marker.needle}\`)`
        report.findings.push(
          marker.severity === 'error' ? err('secret-leak', msg) : warn('secret-leak', msg),
        )
      }
    })
  }
}

// ── orchestration ─────────────────────────────────────────────────────

/** Recursively list `*.ts` files under `dir` (bounded; skips node_modules). */
async function listTsFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(d: string): Promise<void> {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const p = join(d, entry.name)
      if (entry.isDirectory()) await walk(p)
      else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(p)
    }
  }
  await walk(dir)
  return out.sort()
}

export type DomainInput = {
  dir: string
  slug: string
  config: LifecycleConfig
  lifecyclePath?: string
}

/**
 * Run every check against a single already-resolved domain. Pure except
 * for the optional `.env.example` write under `--fix-example`. Never
 * throws on a domain-level problem — it surfaces as an ERROR finding so
 * one bad domain cannot abort the whole scan.
 */
export async function checkDomain(
  input: DomainInput,
  opts: EnvCheckOptions = {},
): Promise<DomainReport> {
  const report: DomainReport = { dir: input.dir, slug: input.slug, findings: [] }
  checkEnvExample(report, input.config, opts)
  checkDevVarsOverlap(report, input.config, input.lifecyclePath)
  checkExtraDevVarsBaseDomain(report, input.config)
  await checkSchemaSoftFallback(report)
  checkCommittedSecrets(report)
  return report
}

/** Wrap an unexpected per-domain failure as an ERROR finding. */
export function loadFailureReport(dir: string, slug: string, e: unknown): DomainReport {
  const msg = e instanceof AstraleError ? e.message : e instanceof Error ? e.message : String(e)
  return { dir, slug, findings: [err('load', `could not load domain config: ${msg}`)] }
}
