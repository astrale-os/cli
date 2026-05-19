/**
 * Cloudflare DomainPlatform — lifecycle methods (dev up/down/status,
 * instance prepare, build spec).
 *
 * Ports the logic previously split across per-domain `scripts/*.ts`
 * templates. The CLI owns the state file (`~/.astrale/domains/<slug>/
 * state.json`) so `devDown` only stops what `devUp` started. Domain
 * customisation happens via an optional `lifecycle.ts` module exposing
 * `config` (data) + `hooks` (code).
 */

import type {
  DevState,
  LifecycleConfig,
  LifecycleContext,
  LifecycleHooks,
} from '@astrale-os/kernel-host'

import { kernelEnvs, type KernelEnv } from '@astrale-os/kernel-host'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type {
  BuildSpecOpts,
  BuildSpecResult,
  DevDownOpts,
  DevDownResult,
  DevStatusOpts,
  DevUpOpts,
  InstancePrepareOpts,
  InstancePrepareResult,
} from '../../ports/domain-platform'

import { AstraleError, IssuerUnreachableError } from '../../errors'
import { resolveDomainDir } from '../../lib/domain-discovery'
import { slugVariants } from '../../lib/domain-scaffold'
import { paths } from '../../lib/env'
import { log } from '../../lib/log'
import { checkIssuerReachability } from '../../lib/meta'
import {
  assertRuntimeSecrets,
  astraleArgv,
  clearDevState,
  clientPkgHasScript,
  domainUrl,
  effectiveViewsMode,
  ensureAstraleManager,
  evalPreset,
  hashDevVars,
  inspectorPortFor,
  isAstraleRunning,
  isHttpOk,
  isPidAlive,
  killPort,
  killWranglerTree,
  lifecycleConfig,
  loadDomainModule,
  preflightDns,
  readDevState,
  resolveForwardedEnv,
  runClientBuild,
  runHook,
  schemeOf,
  tunnelNameOf,
  vitePortFor,
  waitForUrl,
  writeDevState,
  writeDevVars,
  type DevVars,
  type DomainEnv,
} from './cloudflare-helpers'

// ── envs.ts loading ───────────────────────────────────────────────────

type EnvsModule = {
  domainEnvs: Record<string, () => DomainEnv>
  readDomainPort?: () => number
}

async function loadDomainEnvs(domainDir: string): Promise<EnvsModule> {
  const envsPath = join(domainDir, 'envs.ts')
  if (!existsSync(envsPath)) {
    throw new AstraleError('NO_ENVS', `Missing envs.ts at ${envsPath}`)
  }
  return loadDomainModule<EnvsModule>(envsPath)
}

function readDomainPort(envs: EnvsModule): number {
  if (typeof envs.readDomainPort === 'function') {
    try {
      return envs.readDomainPort()
    } catch {
      // fall through to default
    }
  }
  const raw = process.env.DOMAIN_PORT
  if (raw) {
    const n = Number.parseInt(raw, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 8787
}

/**
 * Resolve a domain's local wrangler port WITHOUT side effects — the same
 * computation `devUp` does inline (`domain.port ?? readDomainPort`), as a
 * standalone so the multi-domain `dev up` can group domains by port
 * (domains sharing a port reuse one wrangler ⇒ must be serialised).
 */
export async function resolveWorkerPort(domainDir: string, domainPreset: string): Promise<number> {
  const resolved = await resolveDomainDir(domainDir)
  const envs = await loadDomainEnvs(resolved.dir)
  const domain = evalPreset(envs.domainEnvs, domainPreset, 'domain')
  return domain.port ?? readDomainPort(envs)
}

// ── DNS preflight plan ────────────────────────────────────────────────

function buildDnsPreflight(
  kernel: KernelEnv,
  kernelName: string,
  domainName: string,
  domain: DomainEnv,
): Parameters<typeof preflightDns>[0] {
  const hosts: Parameters<typeof preflightDns>[0] = []
  if (kernel.mode === 'standalone' && kernelName.endsWith(':tunneled')) {
    hosts.push({ host: kernel.kernelDomain, kind: 'tunnel' })
  }
  if (kernel.mode === 'manager' && kernelName.endsWith(':tunneled') && kernel.instanceDomain) {
    hosts.push({ host: kernel.instanceDomain.split('/')[0] ?? '', kind: 'tunnel' })
  }
  if (domainName === 'local:tunneled') {
    hosts.push({ host: domain.domain, kind: 'tunnel' })
  } else if (domainName === 'local:inprocess') {
    hosts.push({ host: domain.domain, kind: 'local' })
  }
  return hosts
}

// ── Shared lifecycle context build ────────────────────────────────────

function makeLifecycleContext(
  resolved: { dir: string; slug: string },
  state: DevState,
): LifecycleContext {
  return {
    domainDir: resolved.dir,
    slug: resolved.slug,
    presets: state.presets,
    state,
    log: {
      info: (msg) => log.info(msg),
      warn: (msg) => log.warn(msg),
      debug: (msg) => log.dim(msg),
    },
  }
}

// ── Main methods ──────────────────────────────────────────────────────

export async function devUp(opts: DevUpOpts): Promise<DevState> {
  const resolved = await resolveDomainDir(opts.domainDir)
  const envs = await loadDomainEnvs(resolved.dir)

  const kernel = evalPreset(kernelEnvs, opts.kernel, 'kernel')
  const domain = evalPreset(envs.domainEnvs, opts.domain, 'domain')

  const config = lifecycleConfig(resolved.lifecycle)
  const hooks = (resolved.lifecycle?.hooks ?? {}) as LifecycleHooks
  const tunnelName = tunnelNameOf(config)

  const needsAstrale = kernel.mode === 'manager' && !opts.kernel.startsWith('remote:')
  const needsCloudflared = opts.kernel.endsWith(':tunneled') || opts.domain === 'local:tunneled'
  const needsLocalWorker = opts.domain === 'local:inprocess' || opts.domain === 'local:tunneled'
  const healthPath = config.healthPath ?? '/meta'

  const state: DevState = {
    presets: { kernel: opts.kernel, domain: opts.domain },
    startedAt: new Date().toISOString(),
    started: { astrale: false, cloudflared: null, wrangler: null },
  }

  const ctx = makeLifecycleContext(resolved, state)

  log.step(`dev up — ${resolved.slug}`)
  log.dim(`  kernel=${opts.kernel} domain=${opts.domain}`)
  log.dim(
    `  plan:  astrale=${needsAstrale} cloudflared=${needsCloudflared} wrangler=${needsLocalWorker}`,
  )

  // Pre-flight. Run `preUp` BEFORE the secrets assertion: a domain's preUp
  // hook is the canonical place to populate runtime secrets (e.g. by sourcing
  // `test/.env`), so checking secrets first defeats the purpose of the hook.
  await preflightDns(buildDnsPreflight(kernel, opts.kernel, opts.domain, domain))
  await runHook(hooks.preUp, ctx, 'preUp', resolved.lifecyclePath)
  assertRuntimeSecrets(config, resolved.lifecyclePath)

  // Ensure astrale manager. Idempotent — when the multi-domain `dev up`
  // already ensured it once before fanning out, this is a fast no-op and
  // `started` stays false (so the parent, not each child, owns teardown).
  if (needsAstrale) {
    const { started } = ensureAstraleManager()
    state.started.astrale = started
  }

  // Ensure cloudflared tunnel.
  if (needsCloudflared) {
    const [bun, entry] = astraleArgv()
    const status = spawnSync(bun, [entry, 'tunnel', 'status', tunnelName], {
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'inherit'],
    })
    if (status.status === 0 && /running/i.test(status.stdout)) {
      log.dim(`  tunnel ${tunnelName} already running`)
    } else {
      log.dim(`  starting tunnel ${tunnelName}…`)
      const r = spawnSync(bun, [entry, 'tunnel', 'start', tunnelName], { stdio: 'inherit' })
      if (r.status !== 0) {
        throw new AstraleError(
          'TUNNEL_START_FAILED',
          `astrale tunnel start ${tunnelName} failed`,
          `If the tunnel isn't registered: astrale tunnel setup ${tunnelName}`,
        )
      }
      state.started.cloudflared = { name: tunnelName }
    }
  }

  // Ensure wrangler worker.
  if (needsLocalWorker) {
    const port = domain.port ?? readDomainPort(envs)
    const localHealth = `http://localhost:${port}${healthPath}`
    const workerDir = join(resolved.dir, 'worker')
    if (!existsSync(workerDir)) {
      throw new AstraleError(
        'NO_WORKER_DIR',
        `Expected ${workerDir} to exist`,
        'Shape (b) domains have no worker; dev up only supports shape (a).',
      )
    }

    // ── Views: how the worker serves /ui/* in local dev ──────────────
    // built (default): a fresh one-shot `vite build` every dev up so
    // `dist-client/` is never a stale snapshot. hmr: spawn the client's
    // Vite dev server + set VIEW_DEV_URL so the worker proxies /ui/* to
    // live Vite. Only for domains with a runnable client; ai-gateway /
    // notes (no client/) and the bookshelf/project-tracker stubs (no
    // client package.json) fall through as a total no-op.
    const clientDir = join(workerDir, 'client')
    let viewDevUrl: string | undefined
    let assetsRebuilt = false
    if (clientPkgHasScript(clientDir, 'build')) {
      const mode = effectiveViewsMode(opts.views, config.views)
      const vitePort = vitePortFor(port)
      const buildLog = join(paths.domainLogDir(resolved.slug), 'vite-build.log')
      if (mode === 'hmr') {
        const r = await tryViteHmr({ slug: resolved.slug, clientDir, vitePort })
        if (r.ok) {
          viewDevUrl = r.url
          log.dim(`  views=hmr — Vite dev on :${vitePort}, worker proxies /ui/*`)
        } else if (opts.views === 'hmr') {
          // Forced via --views hmr → hard error for THIS domain. The
          // `up.ts` loop try/catches per domain and continues the rest.
          throw new AstraleError(
            'VITE_HMR_FAILED',
            `views=hmr requested for ${resolved.slug} but Vite dev did not come up: ${r.why}`,
            'Fix the client, or run `astrale domain dev up --views built` for this domain.',
          )
        } else {
          // From config.views — loud warning + fresh built fallback so
          // the domain still works and the trap stays dead.
          log.warn(
            `${resolved.slug}: config.views='hmr' but Vite dev failed (${r.why}). Falling back to a fresh built bundle (no HMR).`,
          )
          runClientBuild(clientDir, buildLog)
          assetsRebuilt = true
        }
      } else {
        // built (also the default). Fresh one-shot build every dev up →
        // deterministically kills the stale-dist-client trap.
        log.dim(`  views=built — fresh vite build → dist-client/`)
        runClientBuild(clientDir, buildLog)
        assetsRebuilt = true
      }
    }

    const baseVars = buildBaseVars(domain, resolved.slug, config, viewDevUrl)
    const envHash = hashDevVars(baseVars)
    const priorState = readDevState(paths.domainState(resolved.slug))
    const priorWrangler = priorState?.started.wrangler ?? null
    const envChanged = priorWrangler?.envHash !== undefined && priorWrangler.envHash !== envHash

    if (envChanged) {
      // Restart-on-env-change (META_TRACE #92): silently skipping when env
      // diverges from the running wrangler is the worst-of-both — the new
      // KERNEL_URL/AGENT_IMAGE/etc. is invisible until the next manual kill.
      const { killed } = killWranglerTree(port)
      log.dim(`  env changed — killed ${killed} listener(s) on :${port}, restarting wrangler`)
      await ensureWranglerWorker({
        domain,
        slug: resolved.slug,
        workerDir,
        port,
        localHealth,
        baseVars,
        envHash,
        state,
      })
    } else if (!assetsRebuilt && (await isHttpOk(localHealth))) {
      // NOTE the `!assetsRebuilt` guard: a fresh `vite build` changes
      // `dist-client/` but NOT `envHash` (which hashes `.dev.vars`
      // only). Without this guard we'd skip here and wrangler would keep
      // serving the OLD asset snapshot — the exact stale-bundle trap. A
      // rebuilt-assets run must fall through to ensureWranglerWorker.
      log.dim(`  wrangler already serving on :${port}`)
      // If we previously started it AND the env still matches, carry the
      // prior wrangler entry forward so the next dev up can keep detecting
      // env drift. If priorWrangler is null we don't own this wrangler
      // (externally started) — leave state.wrangler null so down doesn't
      // touch it.
      if (priorWrangler && priorWrangler.envHash === envHash && isPidAlive(priorWrangler.pid)) {
        state.started.wrangler = priorWrangler
      }
    } else {
      if (assetsRebuilt && (await isHttpOk(localHealth))) {
        // Assets just rebuilt, env unchanged, wrangler already up → it's
        // serving the stale snapshot. writeDevVars sees no change so its
        // own kill won't fire; kill here so ensureWranglerWorker
        // respawns against the fresh dist-client/.
        const { killed } = killWranglerTree(port)
        log.dim(
          `  assets rebuilt — killed ${killed} listener(s) on :${port}, restarting to pick up new dist-client/`,
        )
      }
      await ensureWranglerWorker({
        domain,
        slug: resolved.slug,
        workerDir,
        port,
        localHealth,
        baseVars,
        envHash,
        state,
      })
    }

    // If tunneled, wait for the tunnel to front the worker.
    if (opts.domain === 'local:tunneled') {
      const workerUrl = domainUrl(domain)
      await waitForUrl(`${workerUrl}${healthPath}`, 60_000, 'tunnel → worker')
    }
  }

  await runHook(hooks.postUp, ctx, 'postUp', resolved.lifecyclePath)

  writeDevState(paths.domainState(resolved.slug), state)
  log.success(`dev up — ${resolved.slug} ready`)
  return state
}

export async function devDown(opts: DevDownOpts): Promise<DevDownResult> {
  const resolved = await resolveDomainDir(opts.domainDir)
  const statePath = paths.domainState(resolved.slug)
  const state = readDevState(statePath)
  const hooks = (resolved.lifecycle?.hooks ?? {}) as LifecycleHooks

  if (!state) {
    log.info(`No state file for ${resolved.slug} — nothing to stop.`)
    return { stopped: { astrale: false, cloudflared: null, wrangler: null } }
  }

  const ctx = makeLifecycleContext(resolved, state)

  log.step(`dev down — ${resolved.slug}`)
  await runHook(hooks.preDown, ctx, 'preDown', resolved.lifecyclePath)

  const stopped: DevState['started'] = { astrale: false, cloudflared: null, wrangler: null }

  if (state.started.wrangler) {
    const { port, pid } = state.started.wrangler
    const { killed } = killWranglerTree(port)
    log.dim(`  stopped wrangler on :${port} (pid=${pid}, killed ${killed} listener(s))`)
    // Free the derived Vite dev port (HMR mode). Derived from the worker
    // port — no DevState field needed. No-op if nothing's listening
    // (built mode, or HMR never spawned).
    const vitePort = vitePortFor(port)
    const { killed: viteKilled } = killPort(vitePort)
    if (viteKilled > 0) {
      log.dim(`  stopped vite dev on :${vitePort} (killed ${viteKilled} listener(s))`)
    }
    stopped.wrangler = { port, pid }
  }

  if (state.started.cloudflared) {
    const { name } = state.started.cloudflared
    const [bun, entry] = astraleArgv()
    spawnSync(bun, [entry, 'tunnel', 'stop', name], { stdio: 'ignore' })
    log.dim(`  stopped tunnel ${name}`)
    stopped.cloudflared = { name }
  }

  if (state.started.astrale) {
    const [bun, entry] = astraleArgv()
    spawnSync(bun, [entry, 'stop'], { stdio: 'ignore' })
    log.dim('  stopped astrale manager')
    stopped.astrale = true
  } else {
    log.dim('  astrale manager untouched (not started by dev up)')
  }

  await runHook(hooks.postDown, ctx, 'postDown', resolved.lifecyclePath)

  clearDevState(statePath)
  log.success(`dev down — ${resolved.slug} clean`)
  return { stopped }
}

export async function devStatus(opts: DevStatusOpts): Promise<DevState | null> {
  const resolved = await resolveDomainDir(opts.domainDir)
  const state = readDevState(paths.domainState(resolved.slug))
  if (!state) return null
  // Validate persisted PID — surface stale state without mutating.
  if (state.started.wrangler && state.started.wrangler.pid > 0) {
    if (!isPidAlive(state.started.wrangler.pid)) {
      state.started.wrangler = null
    }
  }
  return state
}

// ── instancePrepare ───────────────────────────────────────────────────

export async function instancePrepare(opts: InstancePrepareOpts): Promise<InstancePrepareResult> {
  const resolved = await resolveDomainDir(opts.domainDir)
  const envs = await loadDomainEnvs(resolved.dir)

  const instanceId = opts.instanceId ?? 'test'
  const kernel = evalPreset(kernelEnvs, opts.kernel, 'kernel')
  const domain = evalPreset(envs.domainEnvs, opts.domain, 'domain')

  validateSlug(domain.domain)
  const aud = domain.domain
  const domainUrlStr = domainUrl(domain)

  if (kernel.mode === 'standalone') {
    // Standalone: instance:prepare is a no-op. Return the same
    // shell-exportable env block as the legacy script so callers can
    // continue to `eval $(astrale domain instance prepare ...)`.
    return {
      instanceId: '',
      domain: domain.domain,
      domainUrl: domainUrlStr,
      workerUrl: domainUrlStr,
      controlUrl: `${schemeOf(kernel.kernelDomain)}://${kernel.kernelDomain}`,
      iss: `${schemeOf(kernel.kernelDomain)}://${kernel.kernelDomain}`,
    }
  }

  if (!isAstraleRunning()) {
    throw new AstraleError(
      'MANAGER_NOT_RUNNING',
      'astrale manager is not running.',
      `Start it: astrale start  (or: astrale domain dev up --kernel ${opts.kernel} --domain ${opts.domain})`,
    )
  }

  // Rebuild the spec for this preset via the platform's own buildSpec.
  await buildSpec({ domainDir: resolved.dir, preset: opts.domain })

  const controlUrl = `${schemeOf(kernel.managerDomain)}://${kernel.managerDomain}`

  if (kernel.instanceDomain) {
    const pinnedId = kernel.instanceDomain.includes('/')
      ? (kernel.instanceDomain.split('/').pop() ?? '')
      : (kernel.instanceDomain.split('.')[0] ?? '')
    if (pinnedId && pinnedId !== instanceId) {
      throw new AstraleError(
        'INSTANCE_ID_MISMATCH',
        `instance id "${instanceId}" mismatches instanceDomain hint "${kernel.instanceDomain}" (pinned to "${pinnedId}")`,
        `Either pass --instance ${pinnedId}, or reconfigure the tunnel for "${instanceId}".`,
      )
    }
  }

  const hint = kernel.instanceDomain
    ? `${schemeOf(kernel.instanceDomain)}://${kernel.instanceDomain}`
    : `${controlUrl}/${instanceId}`

  runCli(['instance', 'delete', instanceId, '--force'], resolved.dir, { allowFail: true })
  runCli(
    ['instance', 'create', instanceId, '--local', '--issuer', hint, '--skip-jwks-check'],
    resolved.dir,
  )

  const iss = await waitForInstanceReady(hint)

  runCli(['instance', 'install', join(resolved.dir, 'spec.json'), '-i', instanceId], resolved.dir)

  // Worker holds in-memory state (cached creds, registries) keyed off the
  // pre-install graph. After `instance install` reseeds the domain, that
  // state is stale; the worker doesn't auto-reload (META_TRACE #74). Kill
  // the recorded wrangler tree so the next `dev up` (or first request)
  // brings up a fresh worker against the new graph state. Only touches
  // wrangler this lifecycle started.
  const installedState = readDevState(paths.domainState(resolved.slug))
  const ownedWrangler = installedState?.started.wrangler
  if (ownedWrangler) {
    const { killed } = killWranglerTree(ownedWrangler.port)
    if (killed > 0) {
      log.info(
        `post-install: killed ${killed} listener(s) on :${ownedWrangler.port} (worker cache was stale after install)`,
      )
      log.info(`Run \`astrale domain dev up\` to restart the worker before e2e tests.`)
    }
    installedState.started.wrangler = null
    writeDevState(paths.domainState(resolved.slug), installedState)
  }

  const parent = `/${domain.domain}`
  const token = runCli(
    ['token', '--audience', aud, '--ttl', '3600', '--instance', instanceId, '--raw'],
    resolved.dir,
    { capture: true },
  ).trim()

  return {
    instanceId,
    domain: domain.domain,
    domainUrl: domainUrlStr,
    workerUrl: domainUrlStr,
    controlUrl,
    iss,
    parent,
    token,
  }
}

function runCli(
  args: string[],
  cwd: string,
  opts: { allowFail?: boolean; capture?: boolean } = {},
): string {
  const [bun, entry] = astraleArgv()
  const r = spawnSync(bun, [entry, ...args], {
    cwd,
    env: process.env,
    encoding: 'utf-8',
    stdio: opts.capture ? ['inherit', 'pipe', 'inherit'] : ['inherit', 2, 'inherit'],
  })
  if (r.status !== 0 && !opts.allowFail) {
    throw new AstraleError(
      'ASTRALE_SUBCOMMAND_FAILED',
      `astrale ${args.join(' ')} failed (exit ${r.status ?? 'null'})`,
    )
  }
  return opts.capture ? r.stdout : ''
}

async function waitForInstanceReady(url: string): Promise<string> {
  const deadline = Date.now() + 30_000
  let lastErr: Error | undefined
  while (Date.now() < deadline) {
    try {
      const { issuer } = await checkIssuerReachability(url)
      return issuer
    } catch (e) {
      if (!(e instanceof IssuerUnreachableError)) throw e
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new AstraleError(
    'INSTANCE_NOT_READY',
    `instance at "${url}" not ready within 30s — ${lastErr?.message ?? 'JWKS unreachable'}`,
    'Check tunnel + Transform Rule (see deploy.md / identity-model.md).',
  )
}

function validateSlug(slug: string): void {
  if (/[^a-zA-Z0-9.\-_]/.test(slug)) {
    throw new AstraleError(
      'UNSAFE_SLUG',
      `domain slug "${slug}" is not path-safe`,
      'schema.domain is used as a path prefix; encode ports via DomainEnv.port.',
    )
  }
}

// ── buildSpec ─────────────────────────────────────────────────────────

export async function buildSpec(opts: BuildSpecOpts): Promise<BuildSpecResult> {
  const resolved = await resolveDomainDir(opts.domainDir)
  const envs = await loadDomainEnvs(resolved.dir)
  const presetName = opts.preset ?? 'prod'
  const domain = evalPreset(envs.domainEnvs, presetName, 'domain')

  // The sdk's build-spec-cli reads env vars: <PREFIX>_BASE_DOMAIN /
  // <PREFIX>_WORKER_URL where PREFIX depends on the template. We set a
  // generic pair that the minimal-remote scaffold already consumes.
  const domainModule = join(resolved.dir, 'domain.ts')
  const outputPath = join(resolved.dir, 'spec.json')
  if (!existsSync(domainModule)) {
    throw new AstraleError(
      'NO_DOMAIN_MODULE',
      `Missing domain.ts at ${domainModule}`,
      'buildSpec requires a `defineRemoteDomain()` export in domain.ts.',
    )
  }

  const buildCli = resolveBuildSpecCli(resolved.dir)
  // `domain.ts` expects `<UPPER_SNAKE>_BASE_DOMAIN` / `<UPPER_SNAKE>_WORKER_URL`
  // (e.g. `NOTES_BASE_DOMAIN` for `notes`). The rename engine stamps the
  // prefix at scaffold time; derive it from the slug the same way here.
  const prefix = slugVariants(resolved.slug).upperSnake
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [`${prefix}_BASE_DOMAIN`]: domain.domain,
    [`${prefix}_WORKER_URL`]: domainUrl(domain),
    // Generic forms — convenient for domains whose domain.ts/schema.ts
    // read the unprefixed names (e.g. newer scaffolds).
    BASE_DOMAIN: domain.domain,
    WORKER_URL: domainUrl(domain),
  }
  const r = spawnSync('bun', ['run', buildCli, domainModule, outputPath], {
    cwd: resolved.dir,
    env,
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    throw new AstraleError('BUILD_SPEC_FAILED', `build-spec failed (exit ${r.status ?? 'null'})`)
  }
  if (!existsSync(outputPath)) {
    throw new AstraleError('SPEC_MISSING', `spec.json not produced at ${outputPath}`)
  }
  return { specPath: outputPath }
}

/**
 * Locate the `@astrale-os/sdk` install the *domain* resolves to. Walks up
 * from `domainDir` for a `node_modules/@astrale-os/sdk`, then follows
 * symlinks (pnpm stores the real package under `.pnpm/`). Returns the
 * real package dir + parsed package.json. We read the install's own
 * `exports` instead of `require.resolve` because the SDK declares only
 * the `import` condition (no `require`), which `createRequire().resolve`
 * cannot honour. Works standalone (npm install) and in-monorepo
 * (pnpm-symlinked to the workspace sdk).
 */
function resolveDomainSdk(domainDir: string): {
  dir: string
  pkg: { version?: string; exports?: Record<string, unknown> }
} {
  let dir = domainDir
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'node_modules', '@astrale-os', 'sdk')
    if (existsSync(candidate)) {
      const real = realpathSync(candidate)
      const pkgPath = join(real, 'package.json')
      if (existsSync(pkgPath)) {
        return { dir: real, pkg: JSON.parse(readFileSync(pkgPath, 'utf-8')) }
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new AstraleError(
    'NO_SDK',
    `Could not find @astrale-os/sdk in node_modules from ${domainDir}`,
    'Run `pnpm install` in the domain so `@astrale-os/sdk` is installed.',
  )
}

/**
 * Absolute path to the SDK's build-spec CLI, from the domain's own
 * installed SDK. Resolves to `src/...ts` in-monorepo (symlinked workspace
 * sdk) or `dist/...js` when installed from the registry — whichever the
 * install's `exports['./domain/build-spec-cli']` points at. Handed to
 * `bun run`; resolving the path does not execute it.
 */
export function resolveBuildSpecCli(domainDir: string): string {
  const { dir, pkg } = resolveDomainSdk(domainDir)
  const entry = pkg.exports?.['./domain/build-spec-cli']
  const rel = typeof entry === 'string' ? entry : (entry as { import?: string } | undefined)?.import
  if (!rel) {
    throw new AstraleError(
      'NO_SDK_BUILD_SPEC',
      `@astrale-os/sdk at ${dir} does not export ./domain/build-spec-cli`,
      'Upgrade @astrale-os/sdk to a version that ships the build-spec-cli export.',
    )
  }
  const cli = join(dir, rel)
  if (!existsSync(cli)) {
    throw new AstraleError(
      'NO_SDK_BUILD_SPEC',
      `Resolved build-spec-cli not found: ${cli}`,
      'The @astrale-os/sdk install looks incomplete — reinstall dependencies.',
    )
  }
  return cli
}

/**
 * Drift fingerprint for the domain's installed SDK. In a monorepo the SDK
 * resolves (via pnpm symlink) to a git working tree → short HEAD
 * (`gitMode: true`, so deploy can run the post-deploy git sdkCommit
 * check). Standalone (npm install) it is not a git checkout → fall back
 * to the installed package version (`gitMode: false`).
 */
export function resolveSdkFingerprint(domainDir: string): {
  sdkDir: string
  sdkCommit: string
  gitMode: boolean
} {
  const { dir, pkg } = resolveDomainSdk(domainDir)
  const head = spawnSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf-8',
  })
  if (head.status === 0) {
    const sha = head.stdout.trim()
    if (sha) return { sdkDir: dir, sdkCommit: sha, gitMode: true }
  }
  if (pkg.version) return { sdkDir: dir, sdkCommit: pkg.version, gitMode: false }
  throw new AstraleError(
    'NO_SDK_COMMIT',
    `Cannot fingerprint @astrale-os/sdk at ${dir}`,
    'Resolved SDK is neither a git checkout nor exposes a package.json version.',
  )
}

// ── Utility: find PID listening on port ───────────────────────────────

/**
 * Resolve the PID of the process listening on `port`. Filters with
 * `-sTCP:LISTEN` so we get only sockets in LISTEN state. When the tsx
 * CLI parent forks a child node process, both inherit the listening
 * fd briefly — we expect to see exactly one PID after stabilisation.
 * If lsof returns multiple, that's an unexpected state (orphan listener,
 * fork still in progress, etc.); we warn and return the highest PID
 * (most recently spawned, since PID allocation is monotonic within a
 * session — accepts the rare PID-wraparound miss in exchange for a
 * useful default that matches the wrangler/tsx happy path).
 *
 * Absolute path — see `cloudflare-helpers.ts` for why bare `lsof` fails
 * under macOS TCC on `~/Documents/`.
 */
function findListenerPid(port: number): number | null {
  const r = spawnSync('/usr/sbin/lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], { encoding: 'utf-8' })
  if (r.status !== 0) return null
  const pids = [
    ...new Set(
      (r.stdout ?? '')
        .split('\n')
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ]
  if (pids.length === 0) return null
  if (pids.length > 1) {
    log.warn(
      `Multiple listeners on :${port}: [${pids.join(', ')}]. Recording highest; check for orphan processes.`,
    )
  }
  return Math.max(...pids)
}

// ── Worker spawn helper ───────────────────────────────────────────────

type WorkerSpawnArgs = {
  domain: DomainEnv
  slug: string
  workerDir: string
  port: number
  localHealth: string
  baseVars: DevVars
  envHash: string
  state: DevState
}

// Merge order is significant: CLI-derived base vars first (incl. an
// optional VIEW_DEV_URL for HMR-mode view serving), then
// `forwardEnv`/`forwardEnvOptional` resolved from process.env (post
// preUp), then `extraDevVars` literals last so an explicit literal
// still wins (e.g. ai-gateway pins BASE_DOMAIN over the preset value).
function buildBaseVars(
  domain: DomainEnv,
  slug: string,
  config: LifecycleConfig | undefined,
  viewDevUrl?: string,
): DevVars {
  const prefix = slugVariants(slug).upperSnake
  return {
    WORKER_URL: domainUrl(domain),
    BASE_DOMAIN: domain.domain,
    [`${prefix}_WORKER_URL`]: domainUrl(domain),
    [`${prefix}_BASE_DOMAIN`]: domain.domain,
    ...(viewDevUrl ? { VIEW_DEV_URL: viewDevUrl } : {}),
    ...resolveForwardedEnv(config),
    ...config?.extraDevVars,
  }
}

async function ensureWranglerWorker(args: WorkerSpawnArgs): Promise<void> {
  const { domain: _domain, slug, workerDir, port, localHealth, baseVars, envHash, state } = args

  const devVarsPath = join(workerDir, '.dev.vars')
  const changed = writeDevVars(devVarsPath, baseVars)
  if (changed) {
    const { killed } = killWranglerTree(port)
    if (killed > 0) log.dim(`  .dev.vars changed — killed ${killed} listener(s) on :${port}`)
  }

  const logDir = paths.domainLogDir(slug)
  mkdirSync(logDir, { recursive: true })
  const logFile = join(logDir, 'wrangler.log')

  // Invoke the locally-installed wrangler binary via the user's login+
  // interactive zsh, so the subshell sources `.zprofile`/`.zshrc` and gets
  // a PATH that contains `node` (the wrangler shim does `exec node …`).
  // `node` is typically installed by Homebrew/nvm/asdf and lives in dirs
  // only added to PATH by interactive shell config. From a `bash -c`
  // subshell with macOS-TCC-stripped env, those dirs aren't visible.
  const wranglerBin = join(workerDir, 'node_modules', '.bin', 'wrangler')
  if (!existsSync(wranglerBin)) {
    throw new AstraleError(
      'NO_WRANGLER',
      `Expected ${wranglerBin} to exist`,
      'Run `pnpm install` in the domain (monorepo: at the workspace root).',
    )
  }
  const spawn = spawnSync(
    '/bin/zsh',
    [
      '-lic',
      // Wrap the `&` in a subshell so the interactive (`-i`) zsh never
      // registers a job → no `[1] <pid>` monitor line and no
      // `zsh: jobs SIGHUPed` warning leaking to the terminal. The
      // process still detaches (nohup + subshell exits → reparented).
      `( cd ${JSON.stringify(workerDir)} && nohup ${JSON.stringify(wranglerBin)} dev --port ${port} --inspector-port ${inspectorPortFor(port)} > ${JSON.stringify(logFile)} 2>&1 & )`,
    ],
    { stdio: 'inherit' },
  )
  if (spawn.status !== 0) {
    throw new AstraleError('WRANGLER_SPAWN_FAILED', `wrangler dev spawn failed`)
  }
  await waitForUrl(localHealth, 30_000, 'wrangler')
  const pid = findListenerPid(port) ?? 0
  state.started.wrangler = { port, pid, envHash }
  log.dim(`  wrangler ready on :${port} (pid=${pid}); logs=${logFile}`)
}

type ViteHmrArgs = {
  slug: string
  clientDir: string
  vitePort: number
}

/**
 * Spawn the client's Vite dev server (detached via zsh-nohup-&, same
 * macOS-TCC PATH reasoning as `ensureWranglerWorker`) on `vitePort` with
 * `--strictPort`, then health-wait `http://127.0.0.1:<vitePort>/ui/`.
 * Returns ok/why instead of throwing — the caller maps a failure to a
 * hard error (forced `--views hmr`) or a fresh-built fallback (config
 * `views: 'hmr'`).
 */
async function tryViteHmr(
  args: ViteHmrArgs,
): Promise<{ ok: true; url: string } | { ok: false; why: string }> {
  const { slug, clientDir, vitePort } = args
  const viteBin = join(clientDir, 'node_modules', '.bin', 'vite')
  if (!existsSync(viteBin)) {
    return { ok: false, why: `vite binary missing at ${viteBin} (run \`pnpm install\`)` }
  }
  // Clear any stale listener first — `--strictPort` would otherwise make
  // the spawn fail against a leftover Vite from a crashed run.
  killPort(vitePort)

  const logDir = paths.domainLogDir(slug)
  mkdirSync(logDir, { recursive: true })
  const logFile = join(logDir, 'vite-dev.log')
  const spawn = spawnSync(
    '/bin/zsh',
    [
      '-lic',
      // Subshell-wrapped `&` — see the wrangler spawn: keeps the
      // interactive zsh's job-control `[1] <pid>` noise off the terminal.
      `( cd ${JSON.stringify(clientDir)} && nohup ${JSON.stringify(viteBin)} --port ${vitePort} --strictPort > ${JSON.stringify(logFile)} 2>&1 & )`,
    ],
    { stdio: 'inherit' },
  )
  if (spawn.status !== 0) {
    return { ok: false, why: `vite dev spawn failed (see ${logFile})` }
  }
  const url = `http://127.0.0.1:${vitePort}`
  try {
    await waitForUrl(`${url}/ui/`, 30_000, 'vite dev')
  } catch (e) {
    return { ok: false, why: `${e instanceof Error ? e.message : String(e)} (see ${logFile})` }
  }
  return { ok: true, url }
}
