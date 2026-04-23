import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_TUNNEL_NAME = 'kernel-e2e'

/**
 * Domain slug derived from `../package.json` name: strips the
 * `@astrale-os/` prefix and the `-domain` suffix so a rename of the
 * package name is the single source of truth. The dev log dir is scoped
 * to that slug so copies of this scaffold never clobber each other's
 * logs under `/tmp`.
 */
function domainSlug(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const pkgPath = join(here, '..', 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string }
  const name = pkg.name ?? ''
  return name.replace(/^@astrale-os\//, '').replace(/-domain$/, '')
}

export const DEFAULT_DEV_LOG_DIR = `/tmp/astrale-${domainSlug()}-dev`

// ── Service liveness ───────────────────────────────────────────────────

/**
 * Astrale manager liveness. Parses `astrale status` JSON and checks
 * `manager.running`. The bare `astrale status` exit code is always 0 —
 * it reports status successfully even when the manager is down.
 */
export function isAstraleRunning(): boolean {
  const r = spawnSync('astrale', ['status'], { encoding: 'utf-8' })
  if (r.status !== 0) return false
  try {
    const status = JSON.parse(r.stdout) as { manager?: { running?: boolean } }
    return status?.manager?.running === true
  } catch {
    return false
  }
}

/** Quick HTTP GET; true on 2xx within `timeoutMs`. */
export async function isHttpOk(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok
  } catch {
    return false
  }
}

// ── Process lifecycle ──────────────────────────────────────────────────

/**
 * Stop the entire wrangler/workerd tree on `port`. Three kill passes —
 * none alone is sufficient. See distribution/scripts/lib.ts for the
 * rationale on each pass.
 */
export function killWranglerTree(port: number): { killed: number } {
  const pids = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf-8' })
    .stdout.split('\n')
    .filter(Boolean)
  if (pids.length > 0) spawnSync('kill', ['-KILL', ...pids])
  spawnSync('pkill', ['-9', '-f', 'wrangler.*dev --port'])
  spawnSync('pkill', ['-9', '-f', 'workerd serve'])
  return { killed: pids.length }
}

// ── Runtime secrets ────────────────────────────────────────────────────

/**
 * Runtime secrets the worker needs to actually serve requests.
 * Minimal-remote has none by default — add your own here and infra:prepare
 * will fail loud if any are missing from env / test/.env.
 */
export const REQUIRED_RUNTIME_SECRETS: readonly string[] = [] as const

export function assertRuntimeSecrets(): void {
  const missing = REQUIRED_RUNTIME_SECRETS.filter((k) => !process.env[k])
  if (missing.length === 0) return
  console.error(
    `✗ Required worker runtime secrets missing from env / test/.env:\n` +
      missing.map((k) => `    - ${k}`).join('\n') +
      `\n  Copy test/.env.example → test/.env and fill in.`,
  )
  process.exit(1)
}

// ── Env preset evaluation ──────────────────────────────────────────────

export function evalPreset<T>(
  presets: Record<string, () => T>,
  name: string | undefined,
  kind: 'kernel' | 'domain',
): T {
  const fn = name ? presets[name] : undefined
  if (!fn) {
    console.error(
      `✗ Unknown ${kind} preset: ${name ?? '(missing)'}\n` +
        `  Valid: ${Object.keys(presets).join(' | ')}`,
    )
    process.exit(1)
  }
  try {
    return fn()
  } catch (e) {
    const msg = (e as Error).message
    console.error(`✗ Failed to evaluate ${kind} preset "${name}": ${msg}`)
    if (msg.includes('must be set in the environment')) {
      console.error(
        `  Hint: missing env vars typically belong in test/.env\n` +
          `  (copy test/.env.example as a starting point).`,
      )
    }
    process.exit(1)
  }
}
