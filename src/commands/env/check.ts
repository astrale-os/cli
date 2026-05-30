import chalk from 'chalk'

import type { CommandDefinition } from '../../command'
import type { DomainReport } from '../../lib/env-check'

import { lifecycleConfig } from '../../adapters/domain-platform/cloudflare-helpers'
import { resolveDomainDir, resolveDomainDirs } from '../../lib/domain-discovery'
import { checkDomain, hasError, loadFailureReport } from '../../lib/env-check'
import { fatal, log } from '../../lib/log'

type Opts = {
  domain?: string
  fixExample?: boolean
  cwd?: string
}

/**
 * Resolve the domain directories to audit. With `--domain <slug>`, narrow
 * the full discovery set down to the matching slug (so the same recursive
 * scan drives both modes); without it, audit every domain found under cwd.
 */
async function resolveTargets(opts: Opts): Promise<string[]> {
  const all = await resolveDomainDirs(opts.cwd)
  if (!opts.domain) return all

  const matches: string[] = []
  for (const dir of all) {
    const resolved = await resolveDomainDir(dir).catch(() => null)
    if (resolved?.slug === opts.domain) matches.push(dir)
  }
  if (matches.length === 0) {
    fatal(
      new Error(
        `No domain with slug "${opts.domain}" found under ${opts.cwd ?? process.cwd()} ` +
          `(discovered: ${all.length} domain(s))`,
      ),
    )
  }
  return matches
}

/** Audit one directory — load its lifecycle config, then run the checks. */
async function auditDir(dir: string, opts: Opts): Promise<DomainReport> {
  let resolved
  try {
    resolved = await resolveDomainDir(dir)
  } catch (e) {
    // Slug derivation/parse failure → surface as a finding (basename label).
    return loadFailureReport(dir, dir.split('/').pop() ?? dir, e)
  }
  return checkDomain(
    {
      dir,
      slug: resolved.slug,
      config: lifecycleConfig(resolved.lifecycle),
      lifecyclePath: resolved.lifecyclePath,
    },
    { fixExample: opts.fixExample },
  )
}

/** Print a single domain's report block. */
function printReport(report: DomainReport): void {
  const errors = report.findings.filter((f) => f.severity === 'error').length
  const warnings = report.findings.filter((f) => f.severity === 'warning').length

  if (errors > 0) {
    log.error(`${chalk.bold(report.slug)} — ${errors} error(s), ${warnings} warning(s)`)
  } else if (warnings > 0) {
    log.warn(`${chalk.bold(report.slug)} — ${warnings} warning(s)`)
  } else {
    log.success(`${chalk.bold(report.slug)} — ok`)
  }

  for (const f of report.findings) {
    const tag = chalk.dim(`[${f.check}]`)
    if (f.severity === 'error') log.error(`  ${tag} ${f.message}`)
    else log.warn(`  ${tag} ${f.message}`)
  }
  if (report.fixed?.length) {
    log.info(`  appended to .env.example: ${report.fixed.join(', ')}`)
  }
  log.dim(`  ${report.dir}`)
}

export default {
  name: 'check',
  description:
    "Audit each domain's env hygiene (.env.example completeness, dev-vars overlap, topology-base-domain leaks, committed secrets). Read-only by default; exits non-zero on any error.",
  afterHelpText: `
Checks (per domain):
  (a) .env.example lists every key in requiredSecrets ∪ forwardEnv
  (b) extraDevVars does not overlap forwardEnv/forwardEnvOptional
  (c) no *_BASE_DOMAIN literal in extraDevVars, and no soft-fallback
      (?? / ||) on a *_BASE_DOMAIN in schema/**/*.ts (must hard-throw)
  (d) no committed secret value (sk_live_/gho_/JWK "d": → error;
      sk_test_ → warning) in wrangler.* or .env.example

Behavior:
  No --domain: scans every domain dir found under the cwd. Warnings do
  not fail; any error exits 1. --fix-example appends the missing
  required keys to each domain's .env.example (never clobbers content).

Examples:
  $ astrale env check
  $ astrale env check --domain integration
  $ astrale env check --fix-example
`,
  options: [
    { flags: '--domain <slug>', description: 'Audit only the domain with this slug' },
    {
      flags: '--fix-example',
      description: 'Append missing required keys to each domain’s .env.example',
    },
    {
      flags: '--cwd <path>',
      description: 'Directory to scan for domains (default: current working directory)',
    },
  ],
  action: async (opts: Opts) => {
    let dirs: string[]
    try {
      dirs = await resolveTargets(opts)
    } catch (e) {
      fatal(e)
    }

    log.step(`env check — ${dirs.length} domain${dirs.length === 1 ? '' : 's'}`)

    const reports: DomainReport[] = []
    for (const dir of dirs) {
      const report = await auditDir(dir, opts)
      reports.push(report)
      printReport(report)
    }

    const errorCount = reports.filter(hasError).length
    if (errorCount > 0) {
      log.error(`${errorCount} domain(s) with errors`)
      process.exit(1)
    }
    log.success('all domains clean (no errors)')
  },
} satisfies CommandDefinition
