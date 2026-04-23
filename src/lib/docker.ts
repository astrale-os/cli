import { readFile, realpath, writeFile, mkdir, access } from 'node:fs/promises'
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

// ─── Image build ──────────────────────────────────────────────

export async function buildManagerImage(opts: { noCache?: boolean } = {}): Promise<void> {
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
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new AstraleError(
      'MISSING_GITHUB_TOKEN',
      'GITHUB_TOKEN env var is required to build the manager image (needed by pnpm ' +
        'to fetch private @astrale-os/* packages from GitHub Packages). Set it to a ' +
        'PAT with `read:packages` scope and retry.',
    )
  }
  const args = ['docker', 'build', '-t', ref, '-f', join(cli, 'docker', 'Dockerfile')]
  args.push('--secret', 'id=github_token,env=GITHUB_TOKEN')
  if (opts.noCache) args.push('--no-cache')
  args.push(ws)
  await runInteractive(args, { env: { ...process.env, GITHUB_TOKEN: token } })
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
      # Anonymous volume overlays the host's /workspace/node_modules with
      # the image's linux-arm64 (matching the container). Prevents native
      # modules compiled for the host (e.g. esbuild darwin-arm64) from
      # being loaded inside the linux container. Reset on \`docker compose
      # down -v\` — needed after an image rebuild that bumps deps.
      - '/workspace/node_modules'
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

export async function composeDown(composePath: string = COMPOSE_PATH): Promise<void> {
  await run(['docker', 'compose', '-f', composePath, 'down', '-v'])
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

export async function composePs(
  composePath: string = COMPOSE_PATH,
): Promise<ComposeServiceStatus[]> {
  try {
    const proc = Bun.spawn(['docker', 'compose', '-f', composePath, 'ps', '--format', 'json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited
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
    return services
  } catch {
    return []
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
  const services = await composePs(composePath)
  return services.some((s) => s.Service === 'manager' && s.State === 'running')
}

export async function waitManagerHealthy(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await probeHttp(url)) return
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

async function run(args: string[]): Promise<void> {
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`${args.join(' ')} failed (${code}): ${err}`)
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
