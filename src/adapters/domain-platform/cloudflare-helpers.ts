/**
 * Helpers for the Cloudflare DomainPlatform adapter's lifecycle methods
 * (`devUp`, `devDown`, `devStatus`, `instancePrepare`, `buildSpec`).
 *
 * Ported from the per-domain `scripts/lib.ts` + `scripts/infra-prepare.ts`
 * template. The adapter centralises these so every domain benefits from
 * a single bug fix.
 */

import type {
  DevState,
  LifecycleConfig,
  LifecycleContext,
  LifecycleHook,
  LifecycleModule,
} from '@astrale-os/kernel-host'

import { spawnSync } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

import { AstraleError } from '../../errors'

export const DEFAULT_TUNNEL_NAME = 'kernel-e2e'
export const HOOK_TIMEOUT_MS = 30_000

// ── URL derivation ────────────────────────────────────────────────────

export type DomainEnv = { domain: string; port?: number }

export function schemeOf(host: string): 'http' | 'https' {
  const hostname = host.replace(/:\d+$/, '')
  return hostname === 'localhost' || hostname.endsWith('.localhost') ? 'http' : 'https'
}

export function hostOf(env: DomainEnv): string {
  return env.port ? `${env.domain}:${env.port}` : env.domain
}

export function domainUrl(env: DomainEnv): string {
  return `${schemeOf(env.domain)}://${hostOf(env)}`
}

// ── Self-spawn (absolute paths) ───────────────────────────────────────

/**
 * Build argv for re-invoking the current astrale CLI as a subprocess.
 *
 * Why not just `spawnSync('astrale', ...)`? Because under macOS TCC
 * restrictions on `~/Documents/`, `process.env.PATH` arrives empty in bun,
 * and any bare `astrale` lookup fails with ENOENT. The current process
 * already knows the absolute paths of bun (`process.execPath`) and the
 * astrale entrypoint (`process.argv[1]`), so we use those instead. Works
 * regardless of TCC, PATH state, or shim presence.
 */
export function astraleArgv(): [string, string] {
  const bun = process.execPath
  const entry = process.argv[1]
  if (!entry) throw new AstraleError('NO_ASTRALE_ENTRY', 'process.argv[1] is unset')
  return [bun, entry]
}

// ── Service liveness ──────────────────────────────────────────────────

export function isAstraleRunning(): boolean {
  const [bun, entry] = astraleArgv()
  const r = spawnSync(bun, [entry, 'status'], { encoding: 'utf-8' })
  if (r.status !== 0) return false
  try {
    const status = JSON.parse(r.stdout) as { manager?: { running?: boolean } }
    return status?.manager?.running === true
  } catch {
    return false
  }
}

export async function isHttpOk(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok
  } catch {
    return false
  }
}

export async function waitForUrl(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isHttpOk(url)) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new AstraleError(
    'TIMEOUT',
    `${label} did not become ready within ${Math.round(timeoutMs / 1000)}s (${url})`,
  )
}

// ── Process lifecycle ─────────────────────────────────────────────────

// Absolute paths for system utilities — `spawnSync` inherits the parent's
// PATH, which is stripped to empty under macOS TCC on `~/Documents/`. Using
// canonical BSD paths sidesteps PATH lookup entirely.
const LSOF = '/usr/sbin/lsof'
const KILL = '/bin/kill'
const PKILL = '/usr/bin/pkill'

/**
 * Kill a wrangler/workerd tree listening on `port`. Three passes — each
 * alone is insufficient. Returns the number of listeners found via lsof
 * on the first pass.
 */
export function killWranglerTree(port: number): { killed: number } {
  const lsof = spawnSync(LSOF, ['-ti', `:${port}`], { encoding: 'utf-8' })
  const pids = (lsof.stdout ?? '').split('\n').filter(Boolean)
  if (pids.length > 0) spawnSync(KILL, ['-KILL', ...pids])
  spawnSync(PKILL, ['-9', '-f', 'wrangler.*dev --port'])
  spawnSync(PKILL, ['-9', '-f', 'workerd serve'])
  return { killed: pids.length }
}

/**
 * Check whether a PID is alive without killing it (`kill 0`). Used by
 * `devStatus` to validate the persisted wrangler PID.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ── Preset evaluation ─────────────────────────────────────────────────

export function evalPreset<T>(
  presets: Record<string, () => T>,
  name: string | undefined,
  kind: 'kernel' | 'domain',
): T {
  const fn = name ? presets[name] : undefined
  if (!fn) {
    throw new AstraleError(
      'UNKNOWN_PRESET',
      `Unknown ${kind} preset: ${name ?? '(missing)'}`,
      `Valid: ${Object.keys(presets).join(' | ')}`,
    )
  }
  try {
    return fn()
  } catch (e) {
    const msg = (e as Error).message
    const hint = msg.includes('must be set in the environment')
      ? 'Missing env vars typically belong in test/.env (copy test/.env.example as a starting point).'
      : undefined
    throw new AstraleError(
      'PRESET_EVAL_FAILED',
      `Failed to evaluate ${kind} preset "${name ?? ''}": ${msg}`,
      hint,
    )
  }
}

// ── Secrets ───────────────────────────────────────────────────────────

export function assertRuntimeSecrets(
  config: LifecycleConfig | undefined,
  lifecyclePath?: string,
): void {
  const required = config?.requiredSecrets ?? []
  if (required.length === 0) return
  const missing = required.filter((k) => !process.env[k])
  if (missing.length === 0) return
  throw new AstraleError(
    'MISSING_SECRETS',
    `Required worker runtime secrets missing:\n${missing.map((k) => `    - ${k}`).join('\n')}`,
    lifecyclePath
      ? `Set these in env / test/.env (declared in ${lifecyclePath}).`
      : 'Set these in env / test/.env.',
  )
}

// ── `.dev.vars` write ─────────────────────────────────────────────────

export type DevVars = Readonly<Record<string, string>>

/**
 * Write `worker/.dev.vars` with the base keys + any `extraDevVars` from
 * lifecycle config. Returns `true` if the file content changed (caller
 * decides whether to kill the running wrangler to pick up new values).
 */
export function writeDevVars(devVarsPath: string, vars: DevVars): boolean {
  const header =
    '# Generated by `astrale domain dev up` — do not hand-edit.\n' +
    '# Add entries via lifecycle.ts → config.extraDevVars.\n'
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const next = `${header}${body}\n`
  let prev = ''
  try {
    prev = readFileSync(devVarsPath, 'utf-8')
  } catch {
    // file missing — treat as empty
  }
  if (prev === next) return false
  mkdirSync(dirname(devVarsPath), { recursive: true })
  writeFileSync(devVarsPath, next)
  return true
}

// ── DNS preflight ─────────────────────────────────────────────────────

export type DnsPreflightHost = { host: string; kind: 'tunnel' | 'local' }

export async function preflightDns(hosts: DnsPreflightHost[]): Promise<void> {
  if (hosts.length === 0) return
  const results = await Promise.all(
    hosts.map((h) =>
      lookup(h.host).then(
        () => null,
        () => h,
      ),
    ),
  )
  const missing = results.filter((h): h is DnsPreflightHost => h !== null)
  if (missing.length === 0) return
  const hasTunnel = missing.some((m) => m.kind === 'tunnel')
  const hasLocal = missing.some((m) => m.kind === 'local')
  const lines: string[] = [`DNS preflight failed for:`]
  for (const m of missing) lines.push(`    - ${m.host} (${m.kind})`)
  if (hasTunnel) {
    lines.push(
      '\nTunnel hostnames — run once per hostname:',
      '  cloudflared tunnel route dns <tunnel-name> <hostname>',
      'and add an ingress entry in ~/.cloudflared/config.yml.',
    )
  }
  if (hasLocal) {
    const localHosts = missing.filter((m) => m.kind === 'local').map((m) => m.host)
    lines.push(
      '\nLocal dev slugs — add to /etc/hosts:',
      ...localHosts.map((h) => `  127.0.0.1 ${h}`),
      '(RFC 6761 resolvers handle `.localhost` automatically on most systems.)',
    )
  }
  throw new AstraleError('DNS_PREFLIGHT_FAILED', lines.join('\n'))
}

// ── State file I/O ────────────────────────────────────────────────────

export function readDevState(statePath: string): DevState | null {
  try {
    return JSON.parse(readFileSync(statePath, 'utf-8')) as DevState
  } catch {
    return null
  }
}

export function writeDevState(statePath: string, state: DevState): void {
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n')
}

export function clearDevState(statePath: string): void {
  try {
    rmSync(statePath, { force: true })
  } catch {
    // ignore
  }
}

// ── Lifecycle hooks ───────────────────────────────────────────────────

/**
 * Run a hook with a timeout; surface errors with the lifecycle path.
 * A missing hook is a no-op.
 */
export async function runHook(
  hook: LifecycleHook | undefined,
  ctx: LifecycleContext,
  label: string,
  lifecyclePath?: string,
): Promise<void> {
  if (!hook) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve(hook(ctx)),
      new Promise<void>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new AstraleError(
                'HOOK_TIMEOUT',
                `Lifecycle hook "${label}" timed out after ${Math.round(HOOK_TIMEOUT_MS / 1000)}s`,
              ),
            ),
          HOOK_TIMEOUT_MS,
        )
      }),
    ])
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const where = lifecyclePath ? ` (${lifecyclePath})` : ''
    throw new AstraleError('HOOK_FAILED', `Lifecycle hook "${label}" threw${where}: ${msg}`)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ── Dynamic import of domain's envs.ts ────────────────────────────────

/**
 * Load a domain's `envs.ts` dynamically. Returns the full module so
 * callers can pull `domainEnvs` + `readDomainPort` (or equivalents)
 * without the CLI needing to depend on any specific domain package.
 */
export async function loadDomainModule<T = Record<string, unknown>>(absPath: string): Promise<T> {
  return (await import(pathToFileURL(absPath).href)) as T
}

// ── Lifecycle module helpers ──────────────────────────────────────────

export function lifecycleConfig(module: LifecycleModule | undefined): LifecycleConfig {
  return module?.config ?? {}
}

export function tunnelNameOf(config: LifecycleConfig): string {
  return config.tunnelName ?? process.env.MINIMAL_TUNNEL_NAME ?? DEFAULT_TUNNEL_NAME
}
