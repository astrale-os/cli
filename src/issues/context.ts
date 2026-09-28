import { execFile } from 'node:child_process'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import type { InstanceStore } from '../lib/instance'

import { AstraleError } from '../errors'
import { resolveInstanceKey } from '../lib/instance'

const execute = promisify(execFile)
const packageName = /^@(?:astrale-os|astrale-domains)\/[a-z0-9][a-z0-9._-]*$/
const version = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/

export interface PackageObservation {
  readonly name: string
  readonly declared?: string
  readonly version?: string
  readonly source: 'installed' | 'local' | 'unresolved'
  readonly commit?: string
  readonly dirty?: boolean
}

export interface IssueContext {
  readonly observedAt: string
  readonly cli: { readonly version: string; readonly platform: string; readonly arch: string }
  readonly runtime: { readonly node: string; readonly bun?: string }
  readonly project?: {
    readonly name: string
    readonly version?: string
    readonly packages: readonly PackageObservation[]
  }
  readonly instance?: { readonly name: string; readonly issuer?: string; readonly url?: string }
}

/** Current local observations only. Never load project code or probe the affected instance. */
export async function collectIssueContext(input: {
  readonly project?: string
  readonly instance?: string
  readonly cwd: string
  readonly cliVersion: string
  readonly instances?: InstanceStore
  readonly now?: () => Date
}): Promise<IssueContext> {
  const project = await observeProject(input.cwd, input.project)
  const instance =
    input.instance === undefined ? undefined : observeInstance(input.instances, input.instance)
  return {
    observedAt: (input.now ?? (() => new Date()))().toISOString(),
    cli: { version: input.cliVersion, platform: process.platform, arch: process.arch },
    runtime: {
      node: process.versions.node,
      ...(process.versions.bun === undefined ? {} : { bun: process.versions.bun }),
    },
    ...(project === undefined ? {} : { project }),
    ...(instance === undefined ? {} : { instance }),
  }
}

async function observeProject(cwd: string, explicit?: string): Promise<IssueContext['project']> {
  let root: string | undefined
  if (explicit !== undefined) {
    root = resolve(cwd, explicit)
    if (!(await stat(root).catch(() => undefined))?.isDirectory()) throw invalidProject()
  } else {
    root = await nearestPackage(cwd)
  }
  if (root === undefined) return undefined
  const manifest = await readManifest(join(root, 'package.json'))
  if (manifest === undefined) {
    if (explicit !== undefined) throw invalidProject()
    return undefined
  }
  // A workspace root does not select any of its Domain packages.
  if (
    explicit === undefined &&
    (manifest.workspaces !== undefined || (await exists(join(root, 'pnpm-workspace.yaml'))))
  ) {
    if (!(await exists(join(root, 'astrale.config.ts')))) return undefined
  }
  const dependencies = new Map<string, string>()
  for (const section of ['peerDependencies', 'devDependencies', 'dependencies']) {
    const values = manifest[section]
    if (!isRecord(values)) continue
    for (const [name, declared] of Object.entries(values)) {
      if (packageName.test(name) && typeof declared === 'string') dependencies.set(name, declared)
    }
  }
  const packages = await Promise.all(
    [...dependencies]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 64)
      .map(([name, declared]) => observePackage(root, name, declared)),
  )
  return {
    name: typeof manifest.name === 'string' ? manifest.name.slice(0, 200) : basename(root),
    ...(admitVersion(manifest.version) === undefined
      ? {}
      : { version: admitVersion(manifest.version)! }),
    packages,
  }
}

async function observePackage(
  root: string,
  name: string,
  declared: string,
): Promise<PackageObservation> {
  const declaration = safeDeclaration(declared)
  const base = { name, ...(declaration === undefined ? {} : { declared: declaration }) }
  for (let directory = root; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name, 'package.json')
    // An unreadable, malformed or dangling nearer install shadows parent installs.
    const installation = await lstat(dirname(candidate)).catch((cause: unknown) => {
      if (isRecord(cause) && cause.code === 'ENOENT') return undefined
      return true
    })
    if (installation === undefined) {
      if (dirname(directory) === directory) return { ...base, source: 'unresolved' }
      continue
    }
    const manifest = await readManifest(candidate)
    if (manifest !== undefined) {
      const installedVersion = admitVersion(manifest.version)
      if (manifest.name !== name || installedVersion === undefined)
        return { ...base, source: 'unresolved' }
      const resolved = await realpath(candidate).catch(() => undefined)
      const local = resolved !== undefined && !resolved.split(sep).includes('node_modules')
      return {
        ...base,
        version: installedVersion,
        source: local ? 'local' : 'installed',
        ...(local ? await localRevision(dirname(resolved!)) : {}),
      }
    }
    return { ...base, source: 'unresolved' }
  }
}

async function localRevision(directory: string): Promise<{ commit?: string; dirty?: boolean }> {
  try {
    const options = { cwd: directory, timeout: 1_000, maxBuffer: 64 * 1024 }
    const { stdout: commit } = await execute('git', ['rev-parse', 'HEAD'], options)
    if (!/^[a-f0-9]{40,64}$/.test(commit.trim())) return {}
    const { stdout: status } = await execute(
      'git',
      [
        '--no-optional-locks',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.untrackedCache=false',
        'status',
        '--porcelain',
        '--untracked-files=normal',
        '--',
        '.',
      ],
      options,
    )
    return { commit: commit.trim(), dirty: status.trim().length > 0 }
  } catch {
    return {}
  }
}

function observeInstance(store: InstanceStore | undefined, name: string): IssueContext['instance'] {
  const key = store === undefined ? undefined : (resolveInstanceKey(store, name) ?? undefined)
  const entry = key === undefined ? undefined : store?.instances[key]
  if (entry === undefined || key === undefined)
    throw new AstraleError(
      'ISSUE_INSTANCE_NOT_FOUND',
      `Instance "${name}" is not bookmarked.`,
      'Use a known instance bookmark or omit -i to report without an instance.',
    )
  // Sanitizing a transport URL is safe; changing an issuer would invent another identity.
  const issuer = entry.issuer === undefined ? undefined : safeCoordinate(entry.issuer)
  return {
    name: key,
    ...(issuer === entry.issuer && issuer !== undefined ? { issuer } : {}),
    ...(entry.url === undefined ? {} : { url: safeCoordinate(entry.url) }),
  }
}

function safeCoordinate(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AstraleError('ISSUE_INSTANCE_INVALID', 'The affected instance has an invalid URL.')
  }
  if (!['https:', 'http:'].includes(url.protocol))
    throw new AstraleError('ISSUE_INSTANCE_INVALID', 'The affected instance has an invalid URL.')
  if (!url.username && !url.password && !url.search && !url.hash) return value
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.href
}

function safeDeclaration(value: string): string | undefined {
  // Never include credential-bearing git URLs or local absolute paths from a manifest.
  return value.length <= 128 && /^(?:workspace:)?[\w.*~^<>=| +-]+$/.test(value) ? value : undefined
}

function admitVersion(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 128 && version.test(value) ? value : undefined
}

async function nearestPackage(cwd: string): Promise<string | undefined> {
  for (let directory = resolve(cwd); ; directory = dirname(directory)) {
    if (await exists(join(directory, 'package.json'))) return directory
    if (dirname(directory) === directory) return undefined
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

async function readManifest(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    if ((await stat(path)).size > 1_000_000) return undefined
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidProject(): AstraleError {
  return new AstraleError(
    'ISSUE_PROJECT_INVALID',
    '--project must name a directory with a readable package.json.',
  )
}
