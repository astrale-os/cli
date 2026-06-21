import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { run } from './proc'

/**
 * `astrale update`, Axis C — keep a domain project's first-party `@astrale-os/*`
 * dependencies current. We DELEGATE to pnpm rather than reimplement a package
 * manager: `pnpm outdated` to detect, `pnpm update --latest` to apply. pnpm owns
 * the hard, easy-to-get-wrong parts — registry/`.npmrc`/auth resolution, the
 * `minimumReleaseAge` supply-chain gate, workspace members, semver, and the
 * lockfile — so this stays a thin, robust shim (mirrors how the CLI delegates
 * skills to `npx skills`). Every call is best-effort: pnpm missing or any error
 * means "nothing to do", never a failed update.
 */

/** The dependency pattern pnpm matches both subcommands against. */
const ASTRALE_DEP_PATTERN = '@astrale-os/*'

export type SdkOutdated = { pkg: string; current: string; latest: string }

/** Is the CLI running at the root of a scaffolded domain project? */
export function inDomainProject(cwd: string = process.cwd()): boolean {
  return existsSync(join(cwd, 'astrale.config.ts'))
}

/**
 * A non-pnpm lockfile means another package manager owns this project; we won't
 * run pnpm against it (that would write a stray `pnpm-lock.yaml`). Returns the
 * foreign PM name, or null when it's pnpm / fresh (Astrale projects are pnpm-first).
 */
export function foreignPackageManager(cwd: string = process.cwd()): 'npm' | 'yarn' | 'bun' | null {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return null
  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm'
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun'
  return null
}

type PnpmOutdatedEntry = { current?: string; wanted?: string; latest?: string }

/**
 * Parse `pnpm outdated --format json` into the deps that actually have a newer
 * release. pnpm only lists outdated packages and never proposes a downgrade, so
 * we just drop entries with no `latest` or where `latest` equals the current
 * version (it lists `wanted` when nothing is installed yet — use that as the
 * "current" we display). Pure (no I/O) so it's unit-testable without spawning.
 */
export function parseSdkOutdated(stdout: string): SdkOutdated[] {
  let parsed: Record<string, PnpmOutdatedEntry>
  try {
    parsed = JSON.parse(stdout || '{}') as Record<string, PnpmOutdatedEntry>
  } catch {
    return []
  }
  const out: SdkOutdated[] = []
  for (const [pkg, entry] of Object.entries(parsed)) {
    const current = entry.current ?? entry.wanted
    if (entry.latest && current && entry.latest !== current) {
      out.push({ pkg, current, latest: entry.latest })
    }
  }
  return out
}

/**
 * Ask pnpm which `@astrale-os/*` deps have a newer release. `pnpm outdated`
 * exits 1 when outdated deps exist — that's not an error, so we parse stdout
 * regardless of exit code. Returns [] when none, pnpm is absent, or anything fails.
 */
export async function findSdkOutdated(cwd: string = process.cwd()): Promise<SdkOutdated[]> {
  try {
    const { stdout } = await run('pnpm', ['outdated', '--format', 'json', ASTRALE_DEP_PATTERN], {
      cwd,
    })
    return parseSdkOutdated(stdout)
  } catch {
    return [] // pnpm not on PATH, etc.
  }
}

/**
 * Apply via `pnpm update --latest --lockfile-only` — pnpm rewrites package.json
 * (preserving exact pins, the scaffold style) and the lockfile, honoring the
 * registry + supply-chain age policy. `--lockfile-only` is deliberate: it updates
 * the manifest + lockfile WITHOUT running install/build scripts, so an `astrale
 * update` never executes a dependency's postinstall (pnpm would otherwise exit
 * non-zero on `ERR_PNPM_IGNORED_BUILDS`) or churns node_modules — the user runs
 * `pnpm install` to materialize, honoring their own build approvals. Surfaces
 * pnpm's output only on failure. Returns true on success.
 */
export async function applySdkUpdate(cwd: string = process.cwd()): Promise<boolean> {
  try {
    const { code, stdout, stderr } = await run(
      'pnpm',
      ['update', '--latest', '--lockfile-only', ASTRALE_DEP_PATTERN],
      { cwd },
    )
    if (code !== 0) process.stderr.write(stdout + stderr)
    return code === 0
  } catch {
    return false
  }
}
