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

import { kernelEnvs } from '@astrale-os/kernel-host'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { AstraleError, LifecycleConfigInvalidError } from '../../errors'
import { log } from '../../lib/log'

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

// `process.kill(pid, 0)` liveness probe (hardened, single source).
export { isPidAlive } from '../../lib/proc'

// ── Port-holder discovery (feature-detected) ──────────────────────────
//
// `spawnSync` inherits the parent's PATH, which is stripped to empty under
// macOS TCC on `~/Documents/` — so the canonical BSD `/usr/sbin/lsof` is
// preferred (no PATH lookup). Linux/Alpine CI has no lsof there: fall back
// to `ss`, then `fuser`. Detected once; a loud warning (never a silent
// no-op) if none is available so `dev up`/`down` failures are legible.

type PortTool = { kind: 'lsof' | 'ss' | 'fuser'; bin: string }
let portToolCache: PortTool | null | undefined

function commandExists(bin: string): boolean {
  if (bin.startsWith('/')) return existsSync(bin)
  const r = spawnSync(bin, ['--version'], { stdio: 'ignore' })
  return (r.error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT'
}

function resolvePortTool(): PortTool | null {
  if (portToolCache !== undefined) return portToolCache
  if (existsSync('/usr/sbin/lsof')) portToolCache = { kind: 'lsof', bin: '/usr/sbin/lsof' }
  else if (commandExists('lsof')) portToolCache = { kind: 'lsof', bin: 'lsof' }
  else if (commandExists('ss')) portToolCache = { kind: 'ss', bin: 'ss' }
  else if (commandExists('fuser')) portToolCache = { kind: 'fuser', bin: 'fuser' }
  else {
    portToolCache = null
    log.warn(
      'No port tool found (lsof/ss/fuser) — cannot detect or reap workers by port; dev up/down may leave orphan wranglers.',
    )
  }
  return portToolCache
}

function uniquePositiveInts(values: Iterable<number>): number[] {
  return [...new Set(values)].filter((n) => Number.isFinite(n) && n > 0)
}

function pidsFromSs(output: string, port: number): number[] {
  const pids: number[] = []
  for (const line of output.split('\n')) {
    // Keep only rows whose local address ends with `:<port>` (ss prints the
    // local addr in one of the first columns; the foreign addr never matches
    // a *listening* sport, so an endsWith check is sufficient here).
    if (!line.split(/\s+/).some((c) => c.endsWith(`:${port}`))) continue
    for (const m of line.matchAll(/pid=(\d+)/g)) pids.push(Number.parseInt(m[1]!, 10))
  }
  return uniquePositiveInts(pids)
}

/**
 * PIDs holding `port`. `listeningOnly` restricts to LISTEN sockets (used to
 * record the worker PID); omit it to also catch a process bound-but-not-yet-
 * listening. Returns `[]` when no port tool is available (already warned).
 */
export function listenersOnPort(port: number, opts: { listeningOnly?: boolean } = {}): number[] {
  const tool = resolvePortTool()
  if (!tool) return []
  if (tool.kind === 'lsof') {
    const args = ['-ti', `:${port}`]
    if (opts.listeningOnly) args.push('-sTCP:LISTEN')
    const r = spawnSync(tool.bin, args, { encoding: 'utf-8' })
    return uniquePositiveInts((r.stdout ?? '').split('\n').map((s) => Number.parseInt(s, 10)))
  }
  if (tool.kind === 'ss') {
    const args = opts.listeningOnly ? ['-tnlpH'] : ['-tnpH']
    const r = spawnSync(tool.bin, args, { encoding: 'utf-8' })
    return pidsFromSs(r.stdout ?? '', port)
  }
  // fuser <port>/tcp prints PIDs (to stdout on newer, stderr on older).
  const r = spawnSync(tool.bin, [`${port}/tcp`], { encoding: 'utf-8' })
  const out = `${r.stdout ?? ''} ${r.stderr ?? ''}`
  return uniquePositiveInts(out.split(/\s+/).map((s) => Number.parseInt(s, 10)))
}

/** SIGKILL each PID individually (never a process-group fan-out — see worker-reaper). */
export function killPids(pids: readonly number[]): { killed: number } {
  let killed = 0
  for (const pid of pids) {
    if (pid <= 0) continue
    try {
      process.kill(pid, 'SIGKILL')
      killed++
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ESRCH') {
        killed++ // already gone — counts as handled
        continue
      }
      log.warn(`Could not kill pid ${pid} on cleanup: ${code ?? String(e)}`)
    }
  }
  return { killed }
}

/**
 * Kill the wrangler/workerd process(es) listening on `port`. Port-scoped:
 * does NOT touch siblings on other ports — the previous global `pkill -f
 * workerd serve` fallback killed every other domain's worker on the host.
 * Note: a wrangler stuck mid-reload is NOT listening, so this can't see it —
 * `reapWorkerWranglers` (worker-reaper.ts) catches those by identity.
 */
export function killWranglerTree(port: number): { killed: number } {
  return killPids(listenersOnPort(port))
}

/**
 * Kill whatever is listening on `port` (port-scoped, no broad pkill).
 * Used to free a domain's derived Vite dev port on `devDown`, and to
 * clear a stale Vite before re-spawning on `devUp` (Vite's
 * `--strictPort` would otherwise fail against a leftover listener).
 */
export function killPort(port: number): { killed: number } {
  return killPids(listenersOnPort(port))
}

// ── Client views (dev `/ui/*` serving) ────────────────────────────────

/**
 * Deterministic per-domain Vite dev port derived from the worker port.
 * `+40000` keeps it clear of the worker range, and unique whenever
 * worker ports are unique — so spawning Vite with `--port <this>` won't
 * collide with a sibling domain. Worker ports are now centrally unique
 * per domain (each domain's `envs.ts` readDomainPort default), so every
 * derived Vite port is unique too and domains can run concurrently.
 */
export function vitePortFor(workerPort: number): number {
  return workerPort + 40_000
}

/**
 * Deterministic per-domain wrangler inspector (devtools) port. `+30000`
 * keeps it clear of the worker range and the `+40000` Vite range.
 *
 * NOTE: no longer passed to `wrangler dev` — the spawn uses
 * `--inspector-port 0` (OS-assigned ephemeral) so two wranglers for the
 * same worker can never collide on a *deterministic* inspector port (that
 * collision was the second necessary condition of the reload loop). Kept
 * exported for reference / potential reuse.
 */
export function inspectorPortFor(workerPort: number): number {
  return workerPort + 30_000
}

/**
 * Effective views mode: `--views` CLI override wins, else the domain's
 * `lifecycle.ts` `config.views`, else `'built'` (the safe default —
 * fresh build every dev up, never a stale `dist-client/`). Explicit
 * only; there is intentionally no filesystem auto-detect.
 */
export function effectiveViewsMode(
  optsViews: 'built' | 'hmr' | undefined,
  configViews: 'built' | 'hmr' | undefined,
): 'built' | 'hmr' {
  return optsViews ?? configViews ?? 'built'
}

/**
 * True iff `clientDir/package.json` exists and declares the npm script
 * `name`. Gates views handling on a *runnable* client: ai-gateway/notes
 * have a `worker/` but no `client/`; bookshelf/project-tracker have a
 * `worker/client/` containing only `node_modules` (no package.json).
 */
export function clientPkgHasScript(clientDir: string, name: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(clientDir, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>
    }
    return typeof pkg.scripts?.[name] === 'string'
  } catch {
    return false
  }
}

/**
 * One-shot, BLOCKING `vite build` for the domain's client SPA. Runs
 * every `dev up` in `'built'` mode (and as the HMR-from-config
 * fallback) so `dist-client/` can never be a stale snapshot. Uses the
 * locally-installed vite via the user's login+interactive zsh — same
 * macOS-TCC PATH reasoning as `ensureWranglerWorker` (node lives in
 * interactive-shell-only PATH dirs). Synchronous (no `nohup`/`&`): the
 * build MUST finish before wrangler serves the freshly-written
 * `dist-client/`. Caller owns `logFile` (keeps this module free of a
 * `paths` import). Throws on a missing binary or non-zero exit.
 */
export function runClientBuild(clientDir: string, logFile: string): void {
  const viteBin = join(clientDir, 'node_modules', '.bin', 'vite')
  if (!existsSync(viteBin)) {
    throw new AstraleError(
      'NO_VITE',
      `Expected ${viteBin} to exist`,
      'Run `pnpm install` in the domain (monorepo: at the workspace root).',
    )
  }
  mkdirSync(dirname(logFile), { recursive: true })
  const r = spawnSync(
    '/bin/zsh',
    [
      '-lic',
      `cd ${JSON.stringify(clientDir)} && ${JSON.stringify(viteBin)} build > ${JSON.stringify(logFile)} 2>&1`,
    ],
    { stdio: 'inherit' },
  )
  if (r.status !== 0) {
    throw new AstraleError(
      'VITE_BUILD_FAILED',
      `vite build failed (exit ${r.status ?? 'null'})`,
      `See ${logFile}`,
    )
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

// ── Astrale manager (shared, idempotent) ─────────────────────────────

/**
 * Does the given kernel preset require a local astrale manager? Mirrors
 * `devUp`'s gating (`kernel.mode === 'manager' && !remote:`) so the
 * multi-domain orchestrator can ensure it once up front.
 */
export function needsAstraleManager(kernelPreset: string): boolean {
  if (kernelPreset.startsWith('remote:')) return false
  return evalPreset(kernelEnvs, kernelPreset, 'kernel').mode === 'manager'
}

/**
 * Assert the local astrale manager is running. Throws when it isn't —
 * callers no longer auto-start it. Auto-start silently forced docker-mode
 * (`astrale start` without `--host-mode`) and its token-gated image
 * rebuild; failing fast lets the caller pick the mode explicitly:
 * `astrale start --host-mode` (local dev) or `astrale start` (docker).
 *
 * Safe to call once before a multi-domain fan-out: a quiet no-op when the
 * manager is up; when it's down every child would throw the same error, so
 * the parent surfaces it once up front.
 */
export function requireAstraleManager(opts: { quiet?: boolean; kernelPreset?: string } = {}): void {
  if (isAstraleRunning()) {
    if (!opts.quiet) log.dim('  astrale manager already running')
    return
  }
  const preset = opts.kernelPreset ? ` (kernel preset '${opts.kernelPreset}' is manager-mode)` : ''
  throw new AstraleError(
    'MANAGER_NOT_RUNNING',
    `Manager not running${preset}.`,
    "Start it first, then re-run: 'astrale start --host-mode' (local dev, no Docker) or 'astrale start' (docker, needs GITHUB_TOKEN).",
  )
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

/**
 * Reject a `lifecycle.ts` whose `extraDevVars` (static literals) overlaps with
 * `forwardEnv` / `forwardEnvOptional` (process.env forwarding). The dev-vars
 * writer applies `extraDevVars` last, so the literal would silently shadow the
 * forwarded value at write time — a misleading footgun the type system can't
 * express. Pure config-shape check; safe to call before `preUp`.
 */
export function assertNoDevVarsKeyOverlap(
  config: LifecycleConfig | undefined,
  domainSlug: string,
  lifecyclePath?: string,
): void {
  const literalKeys = Object.keys(config?.extraDevVars ?? {})
  if (literalKeys.length === 0) return
  const forwarded = new Set<string>([
    ...(config?.forwardEnv ?? []),
    ...(config?.forwardEnvOptional ?? []),
  ])
  const overlap = literalKeys.filter((k) => forwarded.has(k))
  if (overlap.length === 0) return
  throw new LifecycleConfigInvalidError(domainSlug, overlap, lifecyclePath)
}

/**
 * Resolve `config.forwardEnv` / `config.forwardEnvOptional` (semantics
 * documented on `LifecycleConfig`) against the current `process.env`.
 * MUST be called *after* the `preUp` hook so a domain `.env` loaded
 * there is visible — the import-time footgun documented on
 * `LifecycleConfig.extraDevVars`.
 */
export function resolveForwardedEnv(config: LifecycleConfig | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of config?.forwardEnv ?? []) out[k] = process.env[k] ?? ''
  for (const k of config?.forwardEnvOptional ?? []) {
    const v = process.env[k]
    if (v) out[k] = v
  }
  return out
}

// ── `.dev.vars` write ─────────────────────────────────────────────────

export type DevVars = Readonly<Record<string, string>>

/**
 * Write `worker/.dev.vars` with the base keys + any `extraDevVars` from
 * lifecycle config. Returns `true` if the file content changed (caller
 * decides whether to kill the running wrangler to pick up new values).
 */
/**
 * Write a `KEY=value\n` env file. Used for both `worker/.dev.vars`
 * (wrangler) and `worker/.env.dev` (node-tsx) — the format is identical;
 * only the destination filename differs. Returns `true` if the content
 * changed (caller decides whether to kill+respawn the worker).
 */
function writeEnvFile(filePath: string, vars: DevVars): boolean {
  const header =
    '# Generated by `astrale domain dev up` — do not hand-edit.\n' +
    '# Add entries via lifecycle.ts → config.extraDevVars (literals)\n' +
    '# or config.forwardEnv / forwardEnvOptional (process.env names).\n'
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const next = `${header}${body}\n`
  let prev = ''
  try {
    prev = readFileSync(filePath, 'utf-8')
  } catch {
    // file missing — treat as empty
  }
  if (prev === next) return false
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, next)
  return true
}

export function writeDevVars(devVarsPath: string, vars: DevVars): boolean {
  return writeEnvFile(devVarsPath, vars)
}

/**
 * SHA-256 hash of a DevVars object with sorted keys. Used to detect when
 * resolved env diverges from the running wrangler's recorded env so dev
 * up can restart instead of skipping silently (META_TRACE #92).
 */
export function hashDevVars(vars: DevVars): string {
  const sorted: Record<string, string> = {}
  for (const k of Object.keys(vars).sort()) sorted[k] = vars[k]!
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
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
    const state = JSON.parse(readFileSync(statePath, 'utf-8')) as DevState
    // Normalise pre-feature state files into the current shape — matches
    // the type contract `... | null`. (A brief node-tsx slot existed
    // before the workerd-only revert; drop it on read so old state.json
    // files don't carry stale fields forward.)
    state.started.wrangler ??= null
    if ('nodeTsx' in state.started) {
      delete (state.started as Record<string, unknown>).nodeTsx
    }
    return state
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
