/**
 * Shared helpers for the multi-domain `domain dev` commands (`up`,
 * `down`, `status`). Underscore-prefixed so the command registrar in
 * `bin/astrale.ts` (which imports `up`/`down`/`status` explicitly) never
 * picks this up as a command.
 */

import type { DevState } from '@astrale-os/kernel-host'

import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { deriveSlug } from '../../../lib/domain-discovery'
import { log } from '../../../lib/log'

/** Outcome of acting on a single domain, for the end-of-run summary. */
export type DomainResult = {
  dir: string
  label: string
  ok: boolean
  error?: string
  /**
   * Parent-resolved wrangler port. Set by the multi-domain `dev up`
   * fan-out so the recap can show the URL even for domains that *reuse*
   * a sibling's wrangler (their own `state.wrangler` is null). Absent
   * for `dev down` (legacy one-line rendering).
   */
  port?: number
  /** Persisted dev state — drives the rich recap. Absent for `dev down`. */
  state?: DevState
  /** Tail of the most relevant log on failure (dimmed under the line). */
  logTail?: string
}

/**
 * Human label for a domain directory: its slug derived from
 * `package.json` name, falling back to the directory basename when the
 * manifest is missing or unnamed. Best-effort — never throws.
 */
export function labelFor(dir: string): string {
  try {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string }
      const slug = deriveSlug(pkg.name ?? '')
      if (slug) return slug
    }
  } catch {
    // fall through to basename
  }
  return basename(dir)
}

/**
 * One structured detail segment for a successful domain, derived from
 * its persisted `DevState` + the parent-resolved port. `null` when there
 * is no state to enrich from (legacy `dev down` path).
 */
function richDetail(r: DomainResult): string | null {
  if (!r.state) return null
  const w = r.state.started.wrangler
  const port = w?.port ?? r.port
  const url = port ? `http://localhost:${port}/meta` : '(no worker)'
  // `state.wrangler` is set only when THIS domain owns the wrangler;
  // a domain sharing a sibling's port has it null → "reused".
  const pid = w ? `pid=${w.pid}` : 'reused'
  return `${url}  ${pid}`
}

/**
 * Print a `✔`/`✖` recap. With per-domain `state` (multi-domain `dev up`)
 * it renders a structured block: optional shared-infra header, then
 * URL/pid/owned-vs-reused per domain, plus a dimmed log tail on failure.
 * Without `state` (e.g. `dev down`) it falls back to the legacy
 * one-line-per-domain output — keeping `down.ts` unchanged.
 */
export function printSummary(
  title: string,
  results: DomainResult[],
  headerLines: string[] = [],
): void {
  const n = results.length
  log.step(`${title} (${n} domain${n === 1 ? '' : 's'})`)
  for (const line of headerLines) log.dim(`  ${line}`)
  const width = Math.max(0, ...results.map((r) => r.label.length))
  for (const r of results) {
    const label = r.label.padEnd(width)
    const detail = richDetail(r)
    if (r.ok) {
      log.success(detail ? `${label}  ${detail}` : `${label}  ${r.dir}`)
    } else {
      log.error(`${label}  ${r.dir} — ${r.error ?? 'failed'}`)
      if (r.logTail) {
        for (const line of r.logTail.split('\n')) log.dim(`      ${line}`)
      }
    }
  }
}
