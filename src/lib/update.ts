import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import { compareVersions } from '../admin/registry/order'
import { AstraleError } from '../errors'
import { atomicWrite } from '../state/files'
import { INSTALL_PATH } from '../state/index'
import { acquireInstallLock } from './install-lock'
import { run } from './proc'

const DEFAULT_REPO = 'astrale-os/cli'
const INSTALLER_HINT =
  'Reinstall with: curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh'
export const DEFAULT_UPDATE_CHANNEL = 'latest'

const InstallMetadataSchema = z.object({
  method: z.literal('script'),
  channel: z.string().min(1).default(DEFAULT_UPDATE_CHANNEL),
  version: z.string().min(1).optional(),
  repo: z.string().min(1).default(DEFAULT_REPO),
  bin: z.string().min(1),
  installedAt: z.string().optional(),
})

export type InstallMetadata = z.infer<typeof InstallMetadataSchema>

/** The fields of a GitHub release that decide whether its assets can still change. */
const GitHubReleaseSchema = z.object({ draft: z.boolean(), immutable: z.boolean().optional() })

const UpdateManifestSchema = z.object({
  version: z.string().min(1),
  binaryVersion: z.string().min(1),
  channel: z.string().min(1),
  repo: z.string().min(1).optional(),
  assets: z.record(
    z.string(),
    z.object({ name: z.string().min(1), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/) }),
  ),
})

type UpdateManifest = z.infer<typeof UpdateManifestSchema>

export type Platform = { os: 'darwin' | 'linux'; arch: 'arm64' | 'x64' }

/** A Bun-compiled executable can replace itself; any other runtime is managed elsewhere. */
export type UpdateExecution = { kind: 'standalone' | 'package-managed'; executable: string }

export type UpdateRequest = {
  check?: boolean
  channel?: string
  version?: string
  /**
   * The user named the target (`--channel` or `--version`), so an older release is a deliberate
   * move. Otherwise an older release from another channel than the installed one is not an update.
   */
  explicit?: boolean
  currentVersion: string
  platform?: Platform
  installPath?: string
  execution?: UpdateExecution
  signal?: AbortSignal
}

export type UpdateResult =
  | { status: 'managed'; currentVersion: string; executable: string }
  | {
      status: 'up-to-date' | 'available'
      currentVersion: string
      latestVersion: string
      channel: string
    }
  | {
      status: 'updated'
      previousVersion: string
      currentVersion: string
      channel: string
      bin: string
    }

function detectPlatform(): Platform {
  const { platform: os, arch } = process
  if (os !== 'darwin' && os !== 'linux') {
    throw new AstraleError(
      'UNSUPPORTED_PLATFORM',
      `Unsupported OS "${os}" — Astrale update supports macOS and Linux.`,
    )
  }
  if (arch !== 'arm64' && arch !== 'x64') {
    throw new AstraleError(
      'UNSUPPORTED_PLATFORM',
      `Unsupported CPU architecture "${arch}" — Astrale update supports arm64 and x64.`,
    )
  }
  return { os, arch }
}

export function detectUpdateExecution(): UpdateExecution {
  const standalone = process.versions.bun !== undefined && process.argv[1]?.startsWith('/$bunfs/')
  return { kind: standalone ? 'standalone' : 'package-managed', executable: process.execPath }
}

export function packageManagedUpdateError(executable: string): AstraleError {
  return new AstraleError(
    'UPDATE_PACKAGE_MANAGED',
    'This Astrale process is not the official standalone executable and cannot replace itself.',
    `Active runtime: ${executable}. Remove any package-managed copy, then install with: curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh`,
  )
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

export async function readInstallMetadata(path = INSTALL_PATH): Promise<InstallMetadata> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (!isMissing(error)) throw error
    throw new AstraleError(
      'UPDATE_NOT_SCRIPT_INSTALLED',
      'Astrale was not installed by the official install script.',
      INSTALLER_HINT,
    )
  }
  let parsed: ReturnType<typeof InstallMetadataSchema.safeParse> | undefined
  try {
    parsed = InstallMetadataSchema.safeParse(JSON.parse(raw))
  } catch {
    // Reported below as invalid metadata.
  }
  if (!parsed?.success) {
    throw new AstraleError(
      'UPDATE_BAD_INSTALL_METADATA',
      `Invalid install metadata at ${path}.`,
      INSTALLER_HINT,
    )
  }
  return parsed.data
}

/** The running binary must be the one the script installation recorded. */
async function assertOwnsInstallation(meta: InstallMetadata, executable: string): Promise<void> {
  const resolve = (path: string) =>
    realpath(path).catch((error) => (isMissing(error) ? undefined : Promise.reject(error)))
  const [running, recorded] = await Promise.all([resolve(executable), resolve(meta.bin)])
  if (running === undefined || running !== recorded) {
    throw new AstraleError(
      'UPDATE_INSTALL_MISMATCH',
      'The running Astrale binary does not own the recorded script installation.',
      `Running binary: ${executable}; recorded binary: ${meta.bin}. Refusing to replace a different installation.`,
    )
  }
}

const githubUrl = () => (process.env.ASTRALE_GITHUB_URL ?? 'https://github.com').replace(/\/+$/, '')
const githubApiUrl = () =>
  (process.env.ASTRALE_GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '')

function versionTag(version: string): string {
  return `cli/v${version.replace(/^cli\/v/, '').replace(/^v/, '')}`
}

export function releaseBase(
  meta: Pick<InstallMetadata, 'repo' | 'channel'>,
  request: Pick<UpdateRequest, 'channel' | 'version'>,
): string {
  if (process.env.ASTRALE_UPDATE_BASE) return process.env.ASTRALE_UPDATE_BASE.replace(/\/+$/, '')
  const repo = meta.repo || DEFAULT_REPO
  const tag = request.version ? versionTag(request.version) : (request.channel ?? meta.channel)
  return `${githubUrl()}/${repo}/releases/download/${tag}`
}

/**
 * The base the executable of `version` is downloaded from. A channel release is a movable pointer
 * and its assets can be replaced; only the published `cli/v<version>` release, once GitHub has
 * made it immutable, guarantees the bytes are the ones the release workflow uploaded.
 * An `ASTRALE_UPDATE_BASE` mirror is read as is.
 */
async function immutableReleaseBase(
  meta: Pick<InstallMetadata, 'repo' | 'channel'>,
  version: string,
  signal?: AbortSignal,
): Promise<string> {
  const base = releaseBase(meta, { version })
  if (process.env.ASTRALE_UPDATE_BASE) return base
  const tag = versionTag(version)
  let release: z.infer<typeof GitHubReleaseSchema>
  try {
    const url = `${githubApiUrl()}/repos/${meta.repo || DEFAULT_REPO}/releases/tags/${tag}`
    release = GitHubReleaseSchema.parse(
      JSON.parse((await download(url, signal, GITHUB_API_HEADERS)).toString('utf8')),
    )
  } catch (cause) {
    throw new AstraleError(
      'UPDATE_RELEASE_UNVERIFIED',
      `Could not verify that the Astrale CLI release ${tag} is immutable.`,
      cause instanceof Error ? cause.message : String(cause),
      { cause },
    )
  }
  if (release.draft || release.immutable !== true) {
    throw new AstraleError(
      'UPDATE_RELEASE_MUTABLE',
      `The Astrale CLI release ${tag} is not an immutable GitHub release; refusing to install it.`,
      'Only published, immutable cli/v<version> releases are installed.',
    )
  }
  return base
}

function precedes(left: string, right: string): boolean {
  try {
    return compareVersions(left, right) < 0
  } catch {
    // A non-canonical version cannot be ordered: treat it as a different release.
    return false
  }
}

const GITHUB_API_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
}

/** GET a release file; `file://` bases serve local release directories. */
async function download(
  url: string,
  signal?: AbortSignal,
  headers?: Record<string, string>,
): Promise<Buffer> {
  if (url.startsWith('file://')) return readFile(new URL(url))
  const response = await fetch(url, { signal, headers })
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Extract an archive holding exactly the `astrale` executable into `directory`. */
async function extractBinary(archive: string, directory: string): Promise<string> {
  const listed = await run('tar', ['-tzf', archive])
  if (listed.code !== 0) {
    throw new Error(`Could not inspect update archive: ${listed.stderr.trim()}`)
  }
  if (listed.stdout !== 'astrale\n') {
    throw new Error(
      `Update archive closure is invalid: expected astrale, got ${listed.stdout.trim().split(/\r?\n/u).join(', ')}`,
    )
  }
  const extracted = await run('tar', ['-xzf', archive, '-C', directory])
  if (extracted.code !== 0) {
    throw new Error(`Could not extract update archive: ${extracted.stderr.trim()}`)
  }
  const binary = join(directory, 'astrale')
  await chmod(binary, 0o755)
  return binary
}

async function readManifest(base: string, signal?: AbortSignal): Promise<UpdateManifest> {
  return UpdateManifestSchema.parse(
    JSON.parse((await download(`${base}/manifest.json`, signal)).toString('utf8')),
  )
}

function platformAsset(manifest: UpdateManifest, key: string): UpdateManifest['assets'][string] {
  const asset = manifest.assets[key]
  if (!asset) {
    throw new AstraleError(
      'UPDATE_ASSET_NOT_FOUND',
      `No Astrale CLI release asset for ${key}.`,
      `Available platforms: ${Object.keys(manifest.assets).join(', ')}`,
    )
  }
  return asset
}

async function assertVersion(binary: string, expected: string): Promise<void> {
  const { code, stdout, stderr } = await run(binary, ['--version'])
  if (code !== 0) throw new Error(`Updated binary failed --version: ${stderr.trim()}`)
  if (stdout.trim() !== expected) {
    throw new Error(`Updated binary reported version ${stdout.trim()}, expected ${expected}`)
  }
}

/**
 * Swap `installed` for `next` under the install lock shared with install.sh, then `commit`.
 * When `commit` throws, the previous executable is renamed back before the error propagates.
 */
export async function replaceStandaloneBinary(
  installed: string,
  next: string,
  commit: () => Promise<void>,
): Promise<void> {
  const lock = await acquireInstallLock(installed)
  const staged = `${installed}.next`
  const previous = `${installed}.previous`
  try {
    try {
      await copyFile(installed, previous)
      await copyFile(next, staged)
      await chmod(staged, 0o755)
      await rename(staged, installed)
    } catch (error) {
      // The rename did not commit: the installed executable is unchanged.
      await rm(staged, { force: true })
      await rm(previous, { force: true })
      throw error
    }
    try {
      await commit()
    } catch (error) {
      await rename(previous, installed).catch((rollback) => {
        throw new AggregateError([error, rollback], 'Standalone update rollback failed.')
      })
      throw error
    }
    await rm(previous, { force: true })
  } finally {
    await lock.release()
  }
}

export async function updateAstrale(request: UpdateRequest): Promise<UpdateResult> {
  const execution = request.execution ?? detectUpdateExecution()
  if (execution.kind === 'package-managed') {
    return {
      status: 'managed',
      currentVersion: request.currentVersion,
      executable: execution.executable,
    }
  }

  const meta = await readInstallMetadata(request.installPath)
  await assertOwnsInstallation(meta, execution.executable)
  const currentVersion = meta.version ?? request.currentVersion
  const platform = request.platform ?? detectPlatform()
  const key = `${platform.os}-${platform.arch}`
  // The requested release names the target version and channel. A channel release only points at
  // a version: the executable and its digest come from that version's immutable release.
  const pointerBase = releaseBase(meta, {
    channel: request.channel ?? meta.channel,
    version: request.version,
  })
  const pointer = await readManifest(pointerBase, request.signal)
  platformAsset(pointer, key)
  const release = { currentVersion, latestVersion: pointer.version, channel: pointer.channel }
  if (currentVersion === pointer.version) return { status: 'up-to-date', ...release }
  // A beta installation ahead of `latest` waits for `latest` to catch up; the same channel moving
  // back (a rollback) is still followed.
  if (
    !request.explicit &&
    pointer.channel !== meta.channel &&
    precedes(pointer.version, currentVersion)
  ) {
    return { status: 'up-to-date', ...release }
  }
  if (request.check) return { status: 'available', ...release }

  const base = await immutableReleaseBase(meta, pointer.version, request.signal)
  const manifest = base === pointerBase ? pointer : await readManifest(base, request.signal)
  if (manifest.version !== pointer.version) {
    throw new AstraleError(
      'UPDATE_RELEASE_MISMATCH',
      `The Astrale CLI release ${versionTag(pointer.version)} describes version ${manifest.version}.`,
    )
  }
  const asset = platformAsset(manifest, key)
  const directory = await mkdtemp(join(tmpdir(), 'astrale-update-'))
  try {
    const bytes = await download(`${base}/${asset.name}`)
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== asset.sha256.toLowerCase()) {
      throw new AstraleError(
        'UPDATE_CHECKSUM_MISMATCH',
        `Checksum mismatch for ${asset.name}.`,
        `Expected ${asset.sha256}; got ${actual}.`,
      )
    }
    const archive = join(directory, asset.name)
    await writeFile(archive, bytes)
    const binary = await extractBinary(archive, directory)
    await assertVersion(binary, manifest.binaryVersion)

    await replaceStandaloneBinary(meta.bin, binary, () =>
      atomicWrite(
        request.installPath ?? INSTALL_PATH,
        JSON.stringify(
          {
            ...meta,
            channel: pointer.channel,
            version: manifest.version,
            installedAt: new Date().toISOString(),
          },
          null,
          2,
        ) + '\n',
      ),
    )
    return {
      status: 'updated',
      previousVersion: currentVersion,
      currentVersion: manifest.version,
      channel: pointer.channel,
      bin: meta.bin,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
