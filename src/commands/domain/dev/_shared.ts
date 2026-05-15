/**
 * Shared helpers for the multi-domain `domain dev` commands (`up`,
 * `down`, `status`). Underscore-prefixed so the command registrar in
 * `bin/astrale.ts` (which imports `up`/`down`/`status` explicitly) never
 * picks this up as a command.
 */

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

/** Print a `✔`/`✖` summary, one line per domain. */
export function printSummary(title: string, results: DomainResult[]): void {
  const n = results.length
  log.step(`${title} (${n} domain${n === 1 ? '' : 's'})`)
  const width = Math.max(0, ...results.map((r) => r.label.length))
  for (const r of results) {
    const label = r.label.padEnd(width)
    if (r.ok) {
      log.success(`${label}  ${r.dir}`)
    } else {
      log.error(`${label}  ${r.dir} — ${r.error ?? 'failed'}`)
    }
  }
}
