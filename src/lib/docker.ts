import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile, mkdir, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AstraleError } from '../errors'
import { probeHttp } from './manager-state'
import { COMPOSE_PATH, DATA_DIR, KEYS_DIR, LOGS_DIR } from './paths'

// The manager inside the container always listens on this port; the host
// port mapping rewrites as `127.0.0.1:<managerPort>→container:4400`.
const CONTAINER_MANAGER_PORT = 4400

// ─── Build context detection ───────────────────────────────────

let cliRootPromise: Promise<string> | null = null
let workspaceRootPromise: Promise<string> | null = null
let managerImageTagPromise: Promise<string> | null = null

function cliRoot(): Promise<string> {
  if (!cliRootPromise) {
    const here = dirname(fileURLToPath(import.meta.url))
    cliRootPromise = realpath(resolve(here, '..', '..'))
  }
  return cliRootPromise
}

function workspaceRoot(): Promise<string> {
  if (!workspaceRootPromise) {
    workspaceRootPromise = (async () => {
      const cli = await cliRoot()
      const ws = resolve(cli, '..')
      try {
        await access(join(ws, 'kernel'))
      } catch {
        throw new AstraleError(
          'NO_WORKSPACE',
          `Docker-mode requires a local workspace at ${ws}; no sibling \`kernel/\` found. ` +
            'Run `astrale start --host-mode` or point the CLI at a workspace via `bun link`.',
        )
      }
      return ws
    })()
  }
  return workspaceRootPromise
}

export function managerImageTag(): Promise<string> {
  if (!managerImageTagPromise) {
    managerImageTagPromise = (async () => {
      const cli = await cliRoot()
      const raw = await readFile(join(cli, 'package.json'), 'utf-8')
      const pkg = JSON.parse(raw) as { version?: string }
      if (!pkg.version) throw new Error('cli/package.json has no "version" field')
      return pkg.version
    })()
  }
  return managerImageTagPromise
}

export async function managerImageRef(): Promise<string> {
  return `astrale-os/manager:${await managerImageTag()}`
}

let nodeModulesVolumePromise: Promise<string> | null = null

/**
 * Name of the Docker volume that overlays `/workspace/node_modules` with
 * the image's platform-native deps.
 *
 * It is **named** (not anonymous) so it survives container recreation and
 * `docker compose down` — a plain `astrale reset`/`restart` no longer
 * forces a 1.8 GB re-seed. Correctness across dep bumps is kept by keying
 * the name on a hash of `pnpm-lock.yaml`: when deps change the lockfile
 * changes, so the volume name changes, so compose creates a fresh (empty)
 * volume that Docker auto-seeds from the rebuilt image. Stale volumes from
 * older lockfiles are pruned by {@link pruneStaleNodeModulesVolumes}.
 */
export function nodeModulesVolumeName(): Promise<string> {
  if (!nodeModulesVolumePromise) {
    nodeModulesVolumePromise = (async () => {
      const ws = await workspaceRoot()
      let hash = 'nolock'
      try {
        const lock = await readFile(join(ws, 'pnpm-lock.yaml'), 'utf-8')
        hash = createHash('sha256').update(lock).digest('hex').slice(0, 12)
      } catch {
        // No lockfile (unexpected in a real workspace) — fall back to a
        // stable name so the volume is still named, not anonymous.
      }
      return `astrale-node-modules-${hash}`
    })()
  }
  return nodeModulesVolumePromise
}

// ─── Image build ──────────────────────────────────────────────

export async function buildManagerImage(
  opts: { noCache?: boolean; quiet?: boolean } = {},
): Promise<void> {
  const cli = await cliRoot()
  const ws = await workspaceRoot()
  const ref = await managerImageRef()
  // Build context is the workspace root (the Dockerfile COPY . picks up
  // package.json + pnpm-lock.yaml + all sub-package.json files needed to
  // `pnpm install` inside the image). The workspace `.dockerignore` keeps
  // the context small (no node_modules, no .git, no dist).
  //
  // `GITHUB_TOKEN` (for `@astrale-os/*` on GitHub Packages) is passed as a
  // BuildKit secret — never baked into image layers. The host's `~/.npmrc`
  // references `${GITHUB_TOKEN}` at runtime; the Dockerfile reconstructs
  // a token-embedded `.npmrc` inline for pnpm.
  const token = process.env.GITHUB_TOKEN ?? (await readGithubTokenFromNpmrc())
  if (!token) {
    throw new AstraleError(
      'MISSING_GITHUB_TOKEN',
      'No GitHub Packages token found. Needed by pnpm inside the manager image ' +
        'to fetch private @astrale-os/* packages. Either set `GITHUB_TOKEN` to a ' +
        'PAT with `read:packages` scope, or add it to ~/.npmrc as:\n' +
        '  //npm.pkg.github.com/:_authToken=ghp_yourTokenHere',
    )
  }
  const args = ['docker', 'build', '-t', ref, '-f', join(cli, 'docker', 'Dockerfile')]
  args.push('--secret', 'id=github_token,env=GITHUB_TOKEN')
  if (opts.noCache) args.push('--no-cache')
  args.push(ws)
  const env = { ...process.env, GITHUB_TOKEN: token }
  if (opts.quiet) {
    await run(args, { env })
  } else {
    await runInteractive(args, { env })
  }
}

export async function managerImageExists(): Promise<boolean> {
  try {
    const ref = await managerImageRef()
    await run(['docker', 'image', 'inspect', ref])
    return true
  } catch {
    return false
  }
}

// ─── Compose template ─────────────────────────────────────────

type ComposeInputs = {
  falkorPort: number
  managerPort: number
  graphName: string
  dataDir: string
  keysDir: string
  logsDir: string
  workspaceRoot: string
  imageRef: string
  nodeModulesVolume: string
  uid: number
  gid: number
}

function composeYaml(inputs: ComposeInputs): string {
  const {
    falkorPort,
    managerPort,
    graphName,
    dataDir,
    keysDir,
    logsDir,
    workspaceRoot,
    imageRef,
    nodeModulesVolume,
    uid,
    gid,
  } = inputs
  const cPort = CONTAINER_MANAGER_PORT
  return `services:
  falkordb:
    image: falkordb/falkordb:latest
    ports:
      - '127.0.0.1:${falkorPort}:6379'
    volumes:
      - '${dataDir}:/data'
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  manager:
    image: ${imageRef}
    depends_on:
      falkordb:
        condition: service_healthy
    ports:
      - '127.0.0.1:${managerPort}:${cPort}'
    environment:
      - ASTRALE_IN_CONTAINER=1
      - ASTRALE_HOME=/astrale
      - ASTRALE_MANAGER_PORT=${cPort}
      - ASTRALE_FALKOR_HOST=falkordb
      - ASTRALE_FALKOR_PORT=6379
      - ASTRALE_GRAPH_NAME=${graphName}
      - ASTRALE_PUBLIC_URL=http://localhost:${managerPort}
      - ASTRALE_KEYS_DIR=/astrale/keys
      - ASTRALE_LOGS_DIR=/astrale/logs
    volumes:
      - '${workspaceRoot}:/workspace:ro'
      # Named volume overlays the host's /workspace/node_modules with the
      # image's linux-arm64 deps (matching the container). Prevents native
      # modules compiled for the host (e.g. esbuild darwin-arm64) from
      # being loaded inside the linux container. Name is lockfile-hashed —
      # see nodeModulesVolumeName for why.
      - '${nodeModulesVolume}:/workspace/node_modules'
      - '${keysDir}:/astrale/keys:rw'
      - '${logsDir}:/astrale/logs'
    user: '${uid}:${gid}'
    healthcheck:
      test:
        - CMD
        - bun
        - -e
        - "fetch('http://localhost:${cPort}/mngt/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 5s
    restart: unless-stopped

volumes:
  ${nodeModulesVolume}:
    # Explicit name → no compose project prefix, so the lockfile-hash
    # name is stable and matchable by pruneStaleNodeModulesVolumes.
    name: ${nodeModulesVolume}
`
}

// ─── Public compose API ───────────────────────────────────────

type WriteComposeOptions = {
  falkorPort?: number
  managerPort?: number
  graphName?: string
  dataDir?: string
  keysDir?: string
  logsDir?: string
}

export async function writeComposeFile(
  composePath: string = COMPOSE_PATH,
  opts?: WriteComposeOptions,
): Promise<void> {
  const ws = await workspaceRoot()
  const imageRef = await managerImageRef()

  // Default UID/GID to the host user so bind-mounted volumes written by
  // the container (logs/journal) stay owned by the invoking user.
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0
  const gid = typeof process.getgid === 'function' ? process.getgid() : 0

  const content = composeYaml({
    falkorPort: opts?.falkorPort ?? 6379,
    managerPort: opts?.managerPort ?? 4400,
    graphName: opts?.graphName ?? 'astrale-manager',
    dataDir: opts?.dataDir ?? DATA_DIR,
    keysDir: opts?.keysDir ?? KEYS_DIR,
    logsDir: opts?.logsDir ?? LOGS_DIR,
    workspaceRoot: ws,
    imageRef,
    nodeModulesVolume: await nodeModulesVolumeName(),
    uid,
    gid,
  })

  await mkdir(dirname(composePath), { recursive: true })
  await writeFile(composePath, content)
}

// ─── Lifecycle (whole stack) ──────────────────────────────────

export async function composeUp(composePath: string = COMPOSE_PATH): Promise<void> {
  await run(['docker', 'compose', '-f', composePath, 'up', '-d'])
}

export async function composeStop(composePath: string = COMPOSE_PATH): Promise<void> {
  await run(['docker', 'compose', '-f', composePath, 'stop'])
}

/**
 * Tear down the stack (containers + network). Deliberately **without**
 * `-v`: the only compose-managed volume is the lockfile-hashed
 * `node_modules` overlay, kept on purpose (see {@link nodeModulesVolumeName}).
 * FalkorDB data is a host bind-mount, wiped separately by `astrale reset`'s
 * filesystem phase — so a reset is still total.
 */
export async function composeDown(composePath: string = COMPOSE_PATH): Promise<void> {
  await run(['docker', 'compose', '-f', composePath, 'down'])
}

/**
 * Remove `astrale-node-modules-*` volumes other than {@link keep}. These
 * accumulate as the lockfile changes (one ~1.8 GB volume per dep set).
 * Best-effort: silently skips volumes still in use or a missing docker.
 * Safe to call while the stack is up — the in-use current volume can't be
 * removed, and only stale (unreferenced) volumes are targeted anyway.
 */
export async function pruneStaleNodeModulesVolumes(keep: string): Promise<void> {
  try {
    const proc = Bun.spawn(
      ['docker', 'volume', 'ls', '-q', '--filter', 'name=astrale-node-modules-'],
      { stdout: 'pipe', stderr: 'ignore' },
    )
    const out = await new Response(proc.stdout).text()
    if ((await proc.exited) !== 0) return
    const stale = out
      .split('\n')
      .map((v) => v.trim())
      .filter((v) => v && v !== keep)
    for (const vol of stale) {
      try {
        await run(['docker', 'volume', 'rm', vol])
      } catch {
        // In use by another container, or already gone — leave it.
      }
    }
  } catch {
    // docker unreachable — nothing to prune.
  }
}

/**
 * Best-effort `docker rm -f <name>`. Returns true if the container existed
 * and was removed, false if there was nothing to remove or docker is
 * unreachable. Used by `astrale reset --hard` to mop up containers that
 * may have been started outside compose (e.g. a manually-run FalkorDB).
 */
export async function forceRemoveContainer(name: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['docker', 'rm', '-f', name], { stdout: 'pipe', stderr: 'pipe' })
    const code = await proc.exited
    return code === 0
  } catch {
    // ENOENT (no docker on PATH), spawn errors, etc. — caller treats this
    // as "nothing to remove", which is the right semantic for reset.
    return false
  }
}

export async function composeRestart(
  service: string,
  composePath: string = COMPOSE_PATH,
): Promise<void> {
  await run(['docker', 'compose', '-f', composePath, 'restart', service])
}

export interface ComposeServiceStatus {
  readonly Service: string
  readonly State: string
  readonly Health?: string
}

export interface ComposePsResult {
  readonly services: ComposeServiceStatus[]
  /** Set when the `docker compose ps` invocation itself failed (docker not on
   * PATH, daemon not running, malformed compose file…). When present, callers
   * should surface the issue rather than silently treating it as "no services". */
  readonly error?: string
}

export async function composePs(composePath: string = COMPOSE_PATH): Promise<ComposePsResult> {
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  try {
    proc = Bun.spawn(['docker', 'compose', '-f', composePath, 'ps', '--format', 'json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
  } catch (e) {
    return { services: [], error: e instanceof Error ? e.message : String(e) }
  }
  try {
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited
    if (code !== 0) {
      const err = await new Response(proc.stderr).text()
      return { services: [], error: `docker compose ps exit ${code}: ${err.trim()}` }
    }
    const services: ComposeServiceStatus[] = []
    for (const line of out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)) {
      try {
        const j = JSON.parse(line) as { Service?: string; State?: string; Health?: string }
        if (j.Service) {
          services.push({
            Service: j.Service,
            State: j.State ?? 'unknown',
            Health: j.Health || undefined,
          })
        }
      } catch {
        // ignore malformed line
      }
    }
    return { services }
  } catch (e) {
    return { services: [], error: e instanceof Error ? e.message : String(e) }
  }
}

export function streamManagerLogs(opts: {
  readonly follow?: boolean
  readonly tail?: string
  readonly composePath?: string
}): Promise<void> {
  const args = ['docker', 'compose', '-f', opts.composePath ?? COMPOSE_PATH, 'logs', 'manager']
  if (opts.follow) args.push('-f')
  if (opts.tail) args.push('--tail', opts.tail)
  return runInteractive(args)
}

// ─── Runtime helpers ──────────────────────────────────────────

export async function isManagerRunning(composePath: string = COMPOSE_PATH): Promise<boolean> {
  const { services } = await composePs(composePath)
  return services.some((s) => s.Service === 'manager' && s.State === 'running')
}

export async function waitManagerHealthy(
  url: string,
  opts: { timeoutMs?: number; onTick?: (elapsedMs: number) => void } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await probeHttp(url)) return
    opts.onTick?.(Date.now() - start)
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Manager did not become healthy within ${timeoutMs}ms`)
}

export async function assertDockerAvailable(): Promise<void> {
  try {
    await run(['docker', 'version'])
  } catch {
    throw new AstraleError(
      'DOCKER_UNAVAILABLE',
      'Docker is not available; run `docker --version` to verify.',
    )
  }
}

export async function assertWorkspaceInstalled(): Promise<void> {
  const ws = await workspaceRoot()
  try {
    await access(join(ws, 'node_modules'))
  } catch {
    throw new AstraleError(
      'NO_WORKSPACE_INSTALL',
      `Workspace not installed at ${ws}. Run \`pnpm install\` first.`,
    )
  }
}

// ─── Shell helpers ────────────────────────────────────────────

async function run(args: string[], opts: { env?: Record<string, string> } = {}): Promise<void> {
  const proc = Bun.spawn(args, {
    stdout: 'pipe',
    stderr: 'pipe',
    ...(opts.env ? { env: opts.env } : {}),
  })
  const code = await proc.exited
  if (code !== 0) {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    throw new Error(`${args.join(' ')} failed (${code}): ${stderr || stdout}`)
  }
}

async function runInteractive(
  args: string[],
  opts: { env?: Record<string, string> } = {},
): Promise<void> {
  const proc = Bun.spawn(args, {
    stdout: 'inherit',
    stderr: 'inherit',
    ...(opts.env ? { env: opts.env } : {}),
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`${args.join(' ')} failed (${code})`)
}

// Read the GitHub Packages token from ~/.npmrc when GITHUB_TOKEN env var is
// unset — saves users from having to export it just for `astrale init`. The
// same line (`//npm.pkg.github.com/:_authToken=…`) authenticates `pnpm install`
// at the workspace root, so if their npmrc works for that, it works for this.
async function readGithubTokenFromNpmrc(): Promise<string | null> {
  try {
    const npmrc = await readFile(join(homedir(), '.npmrc'), 'utf8')
    const m = npmrc.match(/^\/\/npm\.pkg\.github\.com\/:_authToken=(.+)$/m)
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null
  } catch {
    return null
  }
}
