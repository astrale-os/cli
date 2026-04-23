import { readFile, realpath, writeFile, mkdir, access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AstraleError } from '../errors'
import { API_TOKEN_ENV } from './api-token'
import { probeHttp } from './manager-state'
import { COMPOSE_PATH, DATA_DIR, KEYS_DIR, LOGS_DIR } from './paths'

// The manager inside the container always listens on this port; the host
// port mapping rewrites as `127.0.0.1:<managerPort>→container:4400`.
const CONTAINER_MANAGER_PORT = 4400

// ─── Build context detection ───────────────────────────────────
//
// All three resolvers memoize their async result: `astrale start` calls
// `managerImageRef` + `workspaceRoot` + `managerImageTag` (via
// `writeComposeFile`) 3–5 times during a single bring-up. Caching the
// promise avoids repeated realpath + stat + readFile syscalls.

let cliRootPromise: Promise<string> | null = null
let workspaceRootPromise: Promise<string> | null = null
let managerImageTagPromise: Promise<string> | null = null

/** CLI source root. When installed via `bun link` (dev), this is `<workspace>/cli`. */
function cliRoot(): Promise<string> {
  if (!cliRootPromise) {
    const here = dirname(fileURLToPath(import.meta.url))
    cliRootPromise = realpath(resolve(here, '..', '..'))
  }
  return cliRootPromise
}

/** Workspace root — contains `cli/`, `kernel/`, `sdk/`, etc. */
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

/** CLI package.json version — used as the manager image tag. */
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

/** Full docker image reference (e.g. `astrale-os/manager:0.1.0`). */
export async function managerImageRef(): Promise<string> {
  return `astrale-os/manager:${await managerImageTag()}`
}

// ─── Image build ──────────────────────────────────────────────

export async function buildManagerImage(opts: { noCache?: boolean } = {}): Promise<void> {
  const cli = await cliRoot()
  const ref = await managerImageRef()
  const args = ['docker', 'build', '-t', ref, '-f', join(cli, 'docker', 'Dockerfile')]
  if (opts.noCache) args.push('--no-cache')
  args.push(cli)
  await runInteractive(args)
}

/** Check whether the manager image is present locally. */
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
  uid: number
  gid: number
  apiToken: string
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
    uid,
    gid,
    apiToken,
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
      - ${API_TOKEN_ENV}=${apiToken}
    volumes:
      - '${workspaceRoot}:/workspace:ro'
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
  apiToken: string
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

  if (!opts?.apiToken) {
    throw new Error('writeComposeFile: apiToken is required')
  }

  const content = composeYaml({
    falkorPort: opts?.falkorPort ?? 6379,
    managerPort: opts?.managerPort ?? 4400,
    graphName: opts?.graphName ?? 'astrale-manager',
    dataDir: opts?.dataDir ?? DATA_DIR,
    keysDir: opts?.keysDir ?? KEYS_DIR,
    logsDir: opts?.logsDir ?? LOGS_DIR,
    workspaceRoot: ws,
    imageRef,
    uid,
    gid,
    apiToken: opts.apiToken,
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

export async function composeRestart(
  service: 'manager' | 'falkordb' | null = null,
  composePath: string = COMPOSE_PATH,
): Promise<void> {
  const args = ['docker', 'compose', '-f', composePath, 'restart']
  if (service) args.push(service)
  await run(args)
}

export async function composeDown(
  opts: { volumes?: boolean } = {},
  composePath: string = COMPOSE_PATH,
): Promise<void> {
  const args = ['docker', 'compose', '-f', composePath, 'down']
  if (opts.volumes) args.push('-v')
  await run(args)
}

type ComposeService = {
  Name: string
  Service: string
  State: string
  Health?: string
  Status?: string
}

export async function composePs(composePath: string = COMPOSE_PATH): Promise<ComposeService[]> {
  try {
    const output = await run(['docker', 'compose', '-f', composePath, 'ps', '--format', 'json'])
    if (!output.trim()) return []
    // Recent docker compose outputs one JSON object per line.
    const lines = output.trim().split('\n').filter(Boolean)
    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as ComposeService
        } catch {
          return null
        }
      })
      .filter((x): x is ComposeService => x !== null)
  } catch {
    return []
  }
}

export async function isManagerRunning(composePath: string = COMPOSE_PATH): Promise<boolean> {
  const services = await composePs(composePath)
  const manager = services.find((s) => s.Service === 'manager')
  if (!manager) return false
  return manager.State === 'running'
}

export async function isFalkorRunning(composePath: string = COMPOSE_PATH): Promise<boolean> {
  const services = await composePs(composePath)
  const falkor = services.find((s) => s.Service === 'falkordb')
  if (!falkor) return false
  return falkor.State === 'running'
}

export async function streamManagerLogs(
  opts: { follow?: boolean; tail?: string } = {},
  composePath: string = COMPOSE_PATH,
): Promise<void> {
  const args = ['docker', 'compose', '-f', composePath, 'logs', 'manager']
  if (opts.follow) args.push('-f')
  if (opts.tail) args.push('--tail', opts.tail)
  await runInteractive(args)
}

/**
 * Poll the manager's HTTP endpoint until it responds, or timeout.
 * Uses the public port mapping (host side) since compose healthchecks
 * target the container-internal port.
 */
export async function waitManagerHealthy(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probeHttp(url, 1_500)) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Manager failed to become healthy within ${timeoutMs}ms at ${url}`)
}

// ─── Preflight checks ─────────────────────────────────────────

/**
 * Verify the host workspace has been `pnpm install`-ed. The manager
 * container bind-mounts `/workspace` read-only and resolves deps from
 * the host's `node_modules` — without it, bun fails with an opaque
 * module-not-found deep inside the mount.
 */
export async function assertWorkspaceInstalled(): Promise<void> {
  const ws = await workspaceRoot()
  try {
    await access(join(ws, 'node_modules', '.pnpm'))
  } catch {
    throw new AstraleError(
      'WORKSPACE_NOT_INSTALLED',
      `Workspace dependencies are missing at ${ws}/node_modules. ` +
        'Run `pnpm install` at the workspace root before `astrale start`.',
    )
  }
}

/**
 * Ensure `docker` + `docker compose` are available and the daemon
 * responds. Throws a clear AstraleError with an install hint otherwise.
 */
export async function assertDockerAvailable(): Promise<void> {
  try {
    await run(['docker', 'version', '--format', '{{.Server.Version}}'])
  } catch {
    throw new AstraleError(
      'DOCKER_UNAVAILABLE',
      "Docker is not running or not installed. Install Docker Desktop or your distro's docker package, then retry.",
    )
  }
  try {
    await run(['docker', 'compose', 'version', '--short'])
  } catch {
    throw new AstraleError(
      'DOCKER_UNAVAILABLE',
      'Docker Compose v2 is missing. Update Docker Desktop or install the `docker-compose-plugin` package.',
    )
  }
}

// ─── Internals ────────────────────────────────────────────────

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`Command failed: ${cmd.join(' ')}\n${stderr || stdout}`)
  }
  return stdout
}

/** Run a command inheriting stdio (for interactive progress / logs). */
async function runInteractive(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Command failed (exit ${exitCode}): ${cmd.join(' ')}`)
  }
}
