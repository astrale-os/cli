import type { ReadableStream as WebReadableStream } from 'node:stream/web'

/**
 * binary.ts — the Claude Code / Codex executable an ACP adapter drives.
 *
 * Each bundled ACP adapter speaks a private protocol to its agent CLI (the Agent
 * SDK's control stream, Codex's experimental app-server API), and neither checks
 * which version it is talking to. So Studio no longer runs whatever `claude` or
 * `codex` the PATH holds: it runs the exact build the adapter was written for,
 * pinned from pnpm-lock.yaml (`pinned-binaries.ts`), downloaded from the npm
 * registry on first use, verified against the lockfile's integrity, and cached
 * under `$ASTRALE_HOME/cache/agents`. Logins and configuration are untouched —
 * the managed build still reads `~/.claude` and `~/.codex`.
 *
 * `DOMAIN_STUDIO_CLAUDE_BIN` / `DOMAIN_STUDIO_CODEX_BIN` opt back into a local
 * executable; Studio then only warns when its version strays from the pin.
 */
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { HarnessCli } from '../../../../shared/types'
import type { AcpProvider } from './command'

import { PINNED_AGENT_BINARIES } from './pinned-binaries'

export interface PinnedArtifact {
  tarball: string
  integrity: string
  /** the executable's path inside the extracted tarball */
  entry: string
}

export interface AgentBinary {
  provider: AcpProvider
  label: string
  /** what the adapter spawns: an absolute path when managed, any command when custom */
  path: string
  source: 'managed' | 'custom'
  /** the build Studio pins — what a managed binary IS, what a custom one is held to */
  pinnedVersion: string
  /** managed only: the published package and where it unpacks */
  artifact?: PinnedArtifact
  directory?: string
  /** custom only: why Studio is not running its own build */
  reason: string
}

export interface EnsureOptions {
  signal?: AbortSignal
  onProgress?: (text: string) => void
}

const OVERRIDES: Record<AcpProvider, string> = {
  claude: 'DOMAIN_STUDIO_CLAUDE_BIN',
  codex: 'DOMAIN_STUDIO_CODEX_BIN',
}

const MARKER = '.complete'
/** A version no Studio has run for this long is dropped when a newer one lands. */
const UNUSED_VERSION_MS = 14 * 24 * 60 * 60_000
/** A staging directory this old belongs to an install that died. */
const ABANDONED_STAGING_MS = 24 * 60 * 60_000
const VERSION_TIMEOUT_MS = 10_000

let musl: boolean | undefined

function isMusl(): boolean {
  // Populated when the runtime is linked against glibc (Node and Bun alike). A
  // full diagnostic report is not cheap, and the answer never changes.
  if (musl === undefined) {
    const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string } }
    musl = !report?.header?.glibcVersionRuntime
  }
  return musl
}

/** The platform keys this machine can run, best first (`linux-x64-musl`, `linux-x64`). */
export function platformKeys(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  musl = platform === 'linux' && isMusl(),
): string[] {
  const base = `${platform}-${arch}`
  return musl ? [`${base}-musl`, base] : [base]
}

export function agentBinaryRoot(): string {
  return join(process.env.ASTRALE_HOME ?? join(homedir(), '.astrale'), 'cache', 'agents')
}

/**
 * Decide which executable a harness runs. Synchronous and side-effect free:
 * nothing is downloaded until `ensureAgentBinary`.
 *
 * `explicit` is a path handed to the harness itself (tests, embedders); it
 * outranks the environment, which outranks the pin.
 */
export function agentBinary(
  provider: AcpProvider,
  explicit?: string,
  keys = platformKeys(),
  root = agentBinaryRoot(),
): AgentBinary {
  const pinned = PINNED_AGENT_BINARIES[provider]
  const base = { provider, label: pinned.label, pinnedVersion: pinned.version }
  const variable = OVERRIDES[provider]
  const override = explicit?.trim() || process.env[variable]?.trim()
  if (override)
    return {
      ...base,
      path: override,
      source: 'custom',
      reason: explicit?.trim() ? 'set by the harness' : `set by ${variable}`,
    }

  const platforms: Record<string, PinnedArtifact> = pinned.platforms
  const key = keys.find((candidate) => platforms[candidate])
  if (!key)
    return {
      ...base,
      path: provider,
      source: 'custom',
      reason: `Studio ships no ${pinned.label} build for ${keys[0]}`,
    }

  const artifact = platforms[key]
  const directory = join(root, provider, pinned.version, key)
  return {
    ...base,
    path: join(directory, ...artifact.entry.split('/')),
    source: 'managed',
    artifact,
    directory,
    reason: 'pinned by Studio',
  }
}

export async function isAgentBinaryInstalled(binary: AgentBinary): Promise<boolean> {
  if (binary.source === 'custom') return true
  return installed(binary.directory!, binary.artifact!)
}

async function installed(directory: string, artifact: PinnedArtifact): Promise<boolean> {
  try {
    if ((await readFile(join(directory, MARKER), 'utf8')).trim() !== artifact.integrity)
      return false
    await access(join(directory, ...artifact.entry.split('/')))
    return true
  } catch {
    return false
  }
}

const inFlight = new Map<string, { done: Promise<void>; listeners: Set<(text: string) => void> }>()
const touched = new Set<string>()

/**
 * Make sure `binary` exists on disk, installing it if it is managed and missing.
 *
 * Concurrent callers share one download; one caller's abort stops only its own
 * wait, never the download the others are waiting on.
 */
export async function ensureAgentBinary(
  binary: AgentBinary,
  options: EnsureOptions = {},
): Promise<void> {
  if (binary.source === 'custom') return
  const directory = binary.directory!
  const artifact = binary.artifact!
  if (options.signal?.aborted) throw new Error('canceled')
  if (await installed(directory, artifact)) {
    await markUsed(directory)
    return
  }

  let install = inFlight.get(directory)
  if (!install) {
    const listeners = new Set<(text: string) => void>()
    const announce = (text: string) => {
      for (const listener of listeners) listener(text)
    }
    const done = installAgentArtifact(artifact, directory, {
      label: `${binary.label} ${binary.pinnedVersion}`,
      onProgress: announce,
    })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(
          `could not install ${binary.label} ${binary.pinnedVersion}: ${reason}. ` +
            `Set ${OVERRIDES[binary.provider]} to run a local ${binary.provider} instead.`,
        )
      })
      .finally(() => inFlight.delete(directory))
    install = { done, listeners }
    inFlight.set(directory, install)
  }

  const listener = options.onProgress
  if (listener) install.listeners.add(listener)
  try {
    if (!options.signal) return await install.done
    const signal = options.signal
    let onAbort: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('canceled'))
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      await Promise.race([install.done, aborted])
    } finally {
      signal.removeEventListener('abort', onAbort!)
    }
  } finally {
    if (listener) install.listeners.delete(listener)
  }
}

/** Refresh the marker once per process, so pruning can tell a version still in use. */
async function markUsed(directory: string): Promise<void> {
  if (touched.has(directory)) return
  touched.add(directory)
  const now = new Date()
  await utimes(join(directory, MARKER), now, now).catch(() => undefined)
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`
}

/**
 * Download, verify and unpack one pinned tarball into `directory`.
 *
 * Everything happens in a private staging directory renamed into place at the
 * end, so a reader sees either nothing or a complete, verified install — and two
 * processes installing at once each produce the same bytes, the loser simply
 * discarding its copy.
 */
export async function installAgentArtifact(
  artifact: PinnedArtifact,
  directory: string,
  options: { label: string; onProgress?: (text: string) => void; fetchImpl?: typeof fetch },
): Promise<void> {
  const progress = options.onProgress ?? (() => {})
  const staging = `${directory}.staging-${process.pid}-${randomUUID()}`
  await mkdir(staging, { recursive: true })
  try {
    const archive = join(staging, 'package.tgz')
    const response = await (options.fetchImpl ?? fetch)(artifact.tarball)
    if (!response.ok || !response.body)
      throw new Error(`${artifact.tarball} answered HTTP ${response.status}`)
    const total = Number(response.headers.get('content-length')) || 0
    progress(`Installing ${options.label}${total ? ` (${formatBytes(total)})` : ''}…`)

    const [algorithm, expected] = splitIntegrity(artifact.integrity)
    const hash = createHash(algorithm)
    let received = 0
    let reported = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        received += chunk.length
        const quarter = total ? Math.floor((received / total) * 4) : 0
        if (quarter > reported && quarter < 4) {
          reported = quarter
          progress(`Installing ${options.label}: ${quarter * 25} %`)
        }
        callback(null, chunk)
      },
    })
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream),
      meter,
      createWriteStream(archive),
    )
    const actual = hash.digest('base64')
    if (actual !== expected)
      throw new Error(
        `integrity mismatch for ${artifact.tarball} (expected ${algorithm}-${expected})`,
      )

    await untar(archive, staging)
    await rm(archive, { force: true })
    const executable = join(staging, ...artifact.entry.split('/'))
    await access(executable).catch(() => {
      throw new Error(`${artifact.entry} is missing from ${artifact.tarball}`)
    })
    await chmod(executable, 0o755)
    await writeFile(join(staging, MARKER), `${artifact.integrity}\n`)

    await publish(staging, directory, artifact)
    progress(`${options.label} installed`)
    await pruneUnusedVersions(directory).catch(() => undefined)
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

function splitIntegrity(integrity: string): [string, string] {
  const separator = integrity.indexOf('-')
  if (separator <= 0) throw new Error(`unsupported integrity ${integrity}`)
  return [integrity.slice(0, separator), integrity.slice(separator + 1)]
}

function untar(archive: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xzf', archive, '-C', destination], (error, _stdout, stderr) => {
      if (!error) return resolve()
      const code = (error as NodeJS.ErrnoException).code
      reject(
        new Error(
          code === 'ENOENT'
            ? '`tar` is required to unpack it and was not found on PATH'
            : `tar failed: ${stderr.trim() || error.message}`,
        ),
      )
    })
  })
}

async function publish(staging: string, directory: string, artifact: PinnedArtifact) {
  await mkdir(join(directory, '..'), { recursive: true })
  try {
    await rename(staging, directory)
    return
  } catch (error) {
    // Another process got there first with the same verified bytes.
    if (await installed(directory, artifact)) return
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'ENOTEMPTY' && code !== 'EPERM') throw error
  }
  // Something incomplete sits where the install goes: replace it.
  await rm(directory, { recursive: true, force: true })
  await rename(staging, directory)
}

/**
 * Drop the other versions of this agent that no Studio has run for two weeks,
 * plus staging left behind by an install that died. `directory` is
 * `<root>/<provider>/<version>/<platform>`.
 */
async function pruneUnusedVersions(directory: string): Promise<void> {
  const versionDirectory = join(directory, '..')
  const providerDirectory = join(versionDirectory, '..')
  const now = Date.now()
  for (const version of await readdir(providerDirectory)) {
    const candidate = join(providerDirectory, version)
    if (candidate === versionDirectory) continue
    const lastUse = await newestMarker(candidate)
    if (lastUse !== undefined ? now - lastUse > UNUSED_VERSION_MS : await olderThan(candidate))
      await rm(candidate, { recursive: true, force: true })
  }
  for (const entry of await readdir(versionDirectory)) {
    const candidate = join(versionDirectory, entry)
    if (entry.includes('.staging-') && (await olderThan(candidate)))
      await rm(candidate, { recursive: true, force: true })
  }
}

async function newestMarker(versionDirectory: string): Promise<number | undefined> {
  let newest: number | undefined
  for (const platform of await readdir(versionDirectory).catch(() => [])) {
    const marker = await stat(join(versionDirectory, platform, MARKER)).catch(() => undefined)
    if (marker) newest = Math.max(newest ?? 0, marker.mtimeMs)
  }
  return newest
}

async function olderThan(path: string, ageMs = ABANDONED_STAGING_MS): Promise<boolean> {
  const info = await stat(path).catch(() => undefined)
  return !!info && Date.now() - info.mtimeMs > ageMs
}

/** `claude --version` → `2.1.288`, or undefined when it cannot be read. */
export function readBinaryVersion(path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(path, ['--version'], { timeout: VERSION_TIMEOUT_MS }, (error, stdout) => {
      resolve(error ? undefined : /\d+\.\d+\.\d+/.exec(stdout)?.[0])
    })
  })
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference) return difference
  }
  return 0
}

/**
 * Why a local executable may not work with the bundled adapter, if it may not.
 *
 * Claude Code keeps its SDK protocol backward compatible, so only a build OLDER
 * than the pin is suspect. Codex's app-server API is experimental, so any other
 * minor release is.
 */
export function versionWarning(
  provider: AcpProvider,
  version: string | undefined,
  pinned: string = PINNED_AGENT_BINARIES[provider].version,
): string | undefined {
  const label = PINNED_AGENT_BINARIES[provider].label
  if (!version) return `Could not read its version; Studio is built for ${label} ${pinned}.`
  if (provider === 'claude') {
    return compareVersions(version, pinned) < 0
      ? `${label} ${version} is older than ${pinned}, the version Studio is built for.`
      : undefined
  }
  const minor = (value: string) => value.split('.').slice(0, 2).join('.')
  return minor(version) !== minor(pinned)
    ? `${label} ${version} differs from ${pinned}, the version Studio is built for.`
    : undefined
}

/** What Settings says about the executable, before and after it ran. */
export async function describeAgentBinary(binary: AgentBinary): Promise<HarnessCli> {
  if (binary.source === 'managed')
    return {
      source: 'managed',
      version: binary.pinnedVersion,
      installed: await isAgentBinaryInstalled(binary),
    }
  const version = await readBinaryVersion(binary.path)
  const warning = versionWarning(binary.provider, version)
  return {
    source: 'custom',
    installed: true,
    reason: binary.reason,
    ...(version ? { version } : {}),
    ...(warning ? { warning } : {}),
  }
}
