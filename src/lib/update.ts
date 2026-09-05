import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'

import { AstraleError } from '../errors'
import { INSTALL_PATH } from '../state/index'
import { run } from './proc'
import { replaceStandaloneCohort } from './standalone-cohort'

export { replaceStandaloneCohort, type StandaloneCohortReplacement } from './standalone-cohort'

const DEFAULT_REPO = 'astrale-os/cli'
export const DEFAULT_UPDATE_CHANNEL = 'latest'

export const InstallMetadataSchema = z.object({
  method: z.literal('script'),
  channel: z.string().min(1).default(DEFAULT_UPDATE_CHANNEL),
  version: z.string().min(1).optional(),
  repo: z.string().min(1).default(DEFAULT_REPO),
  bin: z.string().min(1),
  cohort: z
    .object({
      schemaVersion: z.literal(2),
      binaryVersion: z.string().min(1),
      cloudflaredVersion: z.string().min(1),
    })
    .optional(),
  installedAt: z.string().optional(),
})

export type InstallMetadata = z.infer<typeof InstallMetadataSchema>

const ManifestAssetSchema = z.object({
  name: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
})

const ManifestBaseSchema = z.object({
  version: z.string().min(1),
  channel: z.string().min(1),
  repo: z.string().min(1).optional(),
})

const LegacyUpdateManifestSchema = ManifestBaseSchema.extend({
  schemaVersion: z.undefined().optional(),
  binaryVersion: z.string().min(1).optional(),
  assets: z.record(
    z.string(),
    z.union([
      ManifestAssetSchema,
      z
        .string()
        .min(1)
        .transform((name) => ({ name })),
    ]),
  ),
})

const CohortUpdateManifestSchema = ManifestBaseSchema.extend({
  schemaVersion: z.literal(2),
  binaryVersion: z.string().min(1),
  cloudflaredVersion: z.string().min(1),
  assets: z.record(z.string(), ManifestAssetSchema.required({ sha256: true })),
})

export const UpdateManifestSchema = z.union([
  CohortUpdateManifestSchema,
  LegacyUpdateManifestSchema,
])

export type UpdateManifest = z.infer<typeof UpdateManifestSchema>

export type Platform = {
  os: 'darwin' | 'linux'
  arch: 'arm64' | 'x64'
}

export type UpdateRequest = {
  check?: boolean
  channel?: string
  version?: string
  currentVersion: string
  platform?: Platform
  installPath?: string
  execution?: UpdateExecution
  signal?: AbortSignal
}

export type UpdateExecution =
  | { kind: 'standalone'; executable: string }
  | { kind: 'package-managed'; executable: string }

const admittedScriptInstall = Symbol('admittedScriptInstall')
export type AdmittedScriptInstall = Readonly<{
  metadata: InstallMetadata
  executable: string
  [admittedScriptInstall]: true
}>

export type UpdateResult =
  | {
      status: 'managed'
      currentVersion: string
      executable: string
    }
  | {
      status: 'up-to-date'
      currentVersion: string
      latestVersion: string
      channel: string
    }
  | {
      status: 'available'
      currentVersion: string
      latestVersion: string
      channel: string
    }
  | {
      status: 'repair-available'
      currentVersion: string
      channel: string
      bin: string
    }
  | {
      status: 'updated'
      previousVersion: string
      currentVersion: string
      channel: string
      bin: string
    }
  | {
      status: 'repaired'
      currentVersion: string
      channel: string
      bin: string
    }

export function detectPlatform(): Platform {
  const os = process.platform
  const arch = process.arch
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

export function platformKey(platform: Platform): string {
  return `${platform.os}-${platform.arch}`
}

export function classifyUpdateExecution(input: {
  bunVersion?: string
  executable: string
  entry?: string
}): UpdateExecution {
  return input.bunVersion && input.entry?.startsWith('/$bunfs/')
    ? { kind: 'standalone', executable: input.executable }
    : { kind: 'package-managed', executable: input.executable }
}

export function detectUpdateExecution(): UpdateExecution {
  return classifyUpdateExecution({
    bunVersion: (process.versions as { bun?: string }).bun,
    executable: process.execPath,
    entry: process.argv[1],
  })
}

export function packageManagedUpdateError(executable: string): AstraleError {
  return new AstraleError(
    'UPDATE_PACKAGE_MANAGED',
    'This Astrale process is not the official standalone executable and cannot replace itself.',
    `Active runtime: ${executable}. Remove any package-managed copy, then install with: curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh`,
  )
}

export async function readInstallMetadata(path = INSTALL_PATH): Promise<InstallMetadata> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (!isMissingFile(error)) throw error
    throw new AstraleError(
      'UPDATE_NOT_SCRIPT_INSTALLED',
      'Astrale was not installed by the official install script.',
      'Reinstall with: curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh',
    )
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw badInstallMetadata(path)
  }
  const parsed = InstallMetadataSchema.safeParse(decoded)
  if (!parsed.success) {
    throw badInstallMetadata(path)
  }
  return parsed.data
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function badInstallMetadata(path: string): AstraleError {
  return new AstraleError(
    'UPDATE_BAD_INSTALL_METADATA',
    `Invalid install metadata at ${path}.`,
    'Reinstall with: curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh',
  )
}

export async function admitScriptInstall(
  meta: InstallMetadata,
  execution: Extract<UpdateExecution, { kind: 'standalone' }>,
): Promise<AdmittedScriptInstall> {
  const [running, recorded] = await Promise.all([
    realpathIfExists(execution.executable),
    realpathIfExists(meta.bin),
  ])
  if (running === undefined || recorded === undefined || running !== recorded) {
    throw new AstraleError(
      'UPDATE_INSTALL_MISMATCH',
      'The running Astrale binary does not own the recorded script installation.',
      `Running binary: ${execution.executable}; recorded binary: ${meta.bin}. Refusing to replace a different installation.`,
    )
  }
  return Object.freeze({
    metadata: meta,
    executable: running,
    [admittedScriptInstall]: true as const,
  })
}

async function realpathIfExists(path: string): Promise<string | undefined> {
  try {
    return await realpath(path)
  } catch (error) {
    if (isMissingFile(error)) return undefined
    throw error
  }
}

export async function writeInstallMetadata(
  meta: InstallMetadata,
  path = INSTALL_PATH,
  filesystem: Readonly<{
    mkdir: typeof mkdir
    rename: typeof rename
    rm: typeof rm
    writeFile: typeof writeFile
  }> = {
    mkdir,
    rename,
    rm,
    writeFile,
  },
): Promise<void> {
  const staged = `${path}.next`
  const previous = `${path}.previous`
  await filesystem.mkdir(dirname(path), { recursive: true })
  await filesystem.rm(staged, { force: true })
  await filesystem.rm(previous, { force: true })
  await filesystem.writeFile(staged, JSON.stringify(meta, null, 2) + '\n')

  let backedUp = false
  try {
    try {
      await filesystem.rename(path, previous)
      backedUp = true
    } catch (error) {
      if (!isMissingFile(error)) throw error
    }
    await filesystem.rename(staged, path)
    await filesystem.rm(previous, { force: true })
  } catch (error) {
    const rollback: unknown[] = []
    if (backedUp) {
      await filesystem.rename(previous, path).catch((failure) => rollback.push(failure))
    }
    await filesystem.rm(staged, { force: true }).catch((failure) => rollback.push(failure))
    if (rollback.length > 0) {
      throw new AggregateError(
        [error, ...rollback],
        'Install metadata update and rollback both failed.',
      )
    }
    throw error
  }
}

export function releaseBase(
  meta: InstallMetadata,
  req: Pick<UpdateRequest, 'channel' | 'version'>,
): string {
  if (process.env.ASTRALE_UPDATE_BASE) return process.env.ASTRALE_UPDATE_BASE.replace(/\/+$/, '')
  const repo = meta.repo || DEFAULT_REPO
  if (req.version) {
    const version = req.version.replace(/^cli\/v/, '').replace(/^v/, '')
    return `https://github.com/${repo}/releases/download/cli/v${version}`
  }
  return `https://github.com/${repo}/releases/download/${req.channel ?? meta.channel ?? DEFAULT_UPDATE_CHANNEL}`
}

export async function fetchManifest(base: string, signal?: AbortSignal): Promise<UpdateManifest> {
  const raw = await readUrlText(`${base}/manifest.json`, signal)
  return UpdateManifestSchema.parse(JSON.parse(raw))
}

export function shouldUpdate(currentVersion: string, manifestVersion: string): boolean {
  return currentVersion !== manifestVersion
}

interface UpdateDependencies {
  readonly replaceStandaloneCohort: typeof replaceStandaloneCohort
  readonly writeInstallMetadata: typeof writeInstallMetadata
}

const defaultUpdateDependencies = Object.freeze({ replaceStandaloneCohort, writeInstallMetadata })

export async function updateAstrale(
  req: UpdateRequest,
  dependencies: Partial<UpdateDependencies> = {},
): Promise<UpdateResult> {
  const update = { ...defaultUpdateDependencies, ...dependencies }
  const execution = req.execution ?? detectUpdateExecution()
  if (execution.kind === 'package-managed') {
    return {
      status: 'managed',
      currentVersion: req.currentVersion,
      executable: execution.executable,
    }
  }

  const install = await admitScriptInstall(await readInstallMetadata(req.installPath), execution)
  const meta = install.metadata
  const currentVersion = meta.version ?? req.currentVersion
  const channel = req.channel ?? meta.channel ?? DEFAULT_UPDATE_CHANNEL
  const platform = req.platform ?? detectPlatform()
  const key = platformKey(platform)
  const base = releaseBase(meta, { channel, version: req.version })
  const manifest = await fetchManifest(base, req.signal)
  const asset = manifest.assets[key]
  if (!asset) {
    throw new AstraleError(
      'UPDATE_ASSET_NOT_FOUND',
      `No Astrale CLI release asset for ${key}.`,
      `Available platforms: ${Object.keys(manifest.assets).join(', ')}`,
    )
  }

  const installPath = req.installPath ?? INSTALL_PATH
  const repair = await cohortNeedsRepair(meta, installPath, manifest)
  if (!shouldUpdate(currentVersion, manifest.version) && !repair) {
    return {
      status: 'up-to-date',
      currentVersion,
      latestVersion: manifest.version,
      channel: manifest.channel,
    }
  }

  if (req.check) {
    if (!shouldUpdate(currentVersion, manifest.version) && repair) {
      return {
        status: 'repair-available',
        currentVersion,
        channel: manifest.channel,
        bin: meta.bin,
      }
    }
    return {
      status: 'available',
      currentVersion,
      latestVersion: manifest.version,
      channel: manifest.channel,
    }
  }

  const tmp = await mkdtemp(join(tmpdir(), 'astrale-update-'))
  try {
    const archive = join(tmp, asset.name)
    await downloadToFile(`${base}/${asset.name}`, archive)
    const manifestChecksum = 'sha256' in asset ? asset.sha256 : undefined
    const expected = manifestChecksum ?? (await fetchChecksum(base, asset.name))
    const actual = await sha256File(archive)
    if (actual !== expected.toLowerCase()) {
      throw new AstraleError(
        'UPDATE_CHECKSUM_MISMATCH',
        `Checksum mismatch for ${asset.name}.`,
        `Expected ${expected}; got ${actual}.`,
      )
    }

    const cohortManifest = manifest.schemaVersion === 2
    const cloudflaredVersion =
      manifest.schemaVersion === 2 ? manifest.cloudflaredVersion : undefined
    await extractTarGz(
      archive,
      tmp,
      cohortManifest ? ['astrale', 'astrale-cloudflared', 'LICENSE.cloudflared'] : undefined,
    )
    const nextBin = join(tmp, 'astrale')
    await chmod(nextBin, 0o755)
    await smokeVersion(nextBin, manifest.binaryVersion ?? manifest.version)
    const nextCloudflared = cohortManifest ? join(tmp, 'astrale-cloudflared') : undefined
    const nextLicense = cohortManifest ? join(tmp, 'LICENSE.cloudflared') : undefined
    const installedLicense = cohortManifest
      ? join(dirname(installPath), 'licenses', 'cloudflared.txt')
      : undefined
    if (nextCloudflared && cloudflaredVersion) {
      await chmod(nextCloudflared, 0o755)
      await smokeCloudflaredVersion(nextCloudflared, cloudflaredVersion)
    }

    const replacement = await update.replaceStandaloneCohort({
      installedBinary: meta.bin,
      nextBinary: nextBin,
      nextCloudflared,
      installedLicense,
      nextLicense,
    })
    try {
      await update.writeInstallMetadata(
        {
          ...meta,
          channel: manifest.channel,
          version: manifest.version,
          ...(manifest.schemaVersion === 2
            ? {
                cohort: {
                  schemaVersion: 2 as const,
                  binaryVersion: manifest.binaryVersion,
                  cloudflaredVersion: manifest.cloudflaredVersion,
                },
              }
            : { cohort: undefined }),
          installedAt: new Date().toISOString(),
        },
        req.installPath,
      )
    } catch (error) {
      try {
        await replacement.rollback()
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Standalone update metadata commit and cohort rollback both failed.',
        )
      }
      throw error
    }
    await replacement.finalize()

    return repair && currentVersion === manifest.version
      ? {
          status: 'repaired',
          currentVersion: manifest.version,
          channel: manifest.channel,
          bin: meta.bin,
        }
      : {
          status: 'updated',
          previousVersion: currentVersion,
          currentVersion: manifest.version,
          channel: manifest.channel,
          bin: meta.bin,
        }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

async function readUrlText(url: string, signal?: AbortSignal): Promise<string> {
  if (url.startsWith('file://')) {
    return readFile(new URL(url), 'utf8')
  }
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`)
  return res.text()
}

async function downloadToFile(url: string, path: string): Promise<void> {
  if (url.startsWith('file://')) {
    await copyFile(new URL(url), path)
    return
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  await writeFile(path, bytes)
}

async function fetchChecksum(base: string, assetName: string): Promise<string> {
  const raw = await readUrlText(`${base}/sha256sums.txt`)
  for (const line of raw.split(/\r?\n/)) {
    const [sha, file] = line.trim().split(/\s+/, 2)
    if (!sha || !file) continue
    if (file.replace(/^\*/, '') === assetName && /^[a-fA-F0-9]{64}$/.test(sha)) return sha
  }
  throw new AstraleError(
    'UPDATE_CHECKSUM_NOT_FOUND',
    `Checksum entry not found for ${assetName}.`,
    `Release base: ${base}`,
  )
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return hash.digest('hex')
}

async function extractTarGz(
  archive: string,
  cwd: string,
  exactFiles?: readonly string[],
): Promise<void> {
  const listed = await run('tar', ['-tzf', archive])
  if (listed.code !== 0) {
    throw new Error(`Could not inspect update archive: ${listed.stderr.trim()}`)
  }
  if (exactFiles && listed.stdout !== `${exactFiles.join('\n')}\n`) {
    throw new Error(
      `Update archive closure is invalid: expected ${exactFiles.join(', ')}, got ` +
        `${listed.stdout.trim().split(/\r?\n/u).join(', ')}`,
    )
  }
  const { code, stderr } = await run('tar', ['-xzf', archive, '-C', cwd])
  if (code !== 0) {
    throw new Error(`Could not extract update archive: ${stderr.trim()}`)
  }
}

async function smokeVersion(bin: string, expectedVersion: string): Promise<void> {
  const { code, stdout, stderr } = await run(bin, ['--version'])
  if (code !== 0) throw new Error(`Updated binary failed --version: ${stderr.trim()}`)
  const actual = stdout.trim()
  if (actual !== expectedVersion) {
    throw new Error(`Updated binary reported version ${actual}, expected ${expectedVersion}`)
  }
}

async function smokeCloudflaredVersion(bin: string, expectedVersion: string): Promise<void> {
  const { code, stdout, stderr } = await run(bin, ['--version'])
  if (code !== 0) throw new Error(`Updated cloudflared failed --version: ${stderr.trim()}`)
  const actual = /cloudflared version ([^\s]+)/u.exec(stdout.trim())?.[1]
  if (actual !== expectedVersion) {
    throw new Error(
      `Updated cloudflared reported version ${actual ?? '<invalid>'}, expected ${expectedVersion}`,
    )
  }
}

async function cohortNeedsRepair(
  meta: InstallMetadata,
  installPath: string,
  manifest: UpdateManifest,
): Promise<boolean> {
  if (manifest.schemaVersion !== 2) return false
  if (
    meta.cohort?.schemaVersion !== 2 ||
    meta.cohort.binaryVersion !== manifest.binaryVersion ||
    meta.cohort.cloudflaredVersion !== manifest.cloudflaredVersion
  ) {
    return true
  }
  const cloudflared = join(dirname(meta.bin), 'astrale-cloudflared')
  const license = join(dirname(installPath), 'licenses', 'cloudflared.txt')
  try {
    const [, licenseBytes] = await Promise.all([
      smokeCloudflaredVersion(cloudflared, manifest.cloudflaredVersion),
      readFile(license),
    ])
    return licenseBytes.length === 0
  } catch {
    return true
  }
}
