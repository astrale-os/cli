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

const DEFAULT_REPO = 'astrale-os/cli'
export const DEFAULT_UPDATE_CHANNEL = 'beta'

export const InstallMetadataSchema = z.object({
  method: z.literal('script'),
  channel: z.string().min(1).default(DEFAULT_UPDATE_CHANNEL),
  version: z.string().min(1).optional(),
  repo: z.string().min(1).default(DEFAULT_REPO),
  bin: z.string().min(1),
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

export const UpdateManifestSchema = z.object({
  version: z.string().min(1),
  binaryVersion: z.string().min(1).optional(),
  channel: z.string().min(1),
  repo: z.string().min(1).optional(),
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
      status: 'updated'
      previousVersion: string
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
    'This Astrale build is managed by your package manager.',
    `Active binary: ${executable}. Update it with npm, pnpm, or bun; or put the official script installation first on PATH.`,
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
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(meta, null, 2) + '\n')
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

export async function fetchManifest(base: string): Promise<UpdateManifest> {
  const raw = await readUrlText(`${base}/manifest.json`)
  return UpdateManifestSchema.parse(JSON.parse(raw))
}

export function shouldUpdate(currentVersion: string, manifestVersion: string): boolean {
  return currentVersion !== manifestVersion
}

export async function updateAstrale(req: UpdateRequest): Promise<UpdateResult> {
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
  const manifest = await fetchManifest(base)
  const asset = manifest.assets[key]
  if (!asset) {
    throw new AstraleError(
      'UPDATE_ASSET_NOT_FOUND',
      `No Astrale CLI release asset for ${key}.`,
      `Available platforms: ${Object.keys(manifest.assets).join(', ')}`,
    )
  }

  if (!shouldUpdate(currentVersion, manifest.version)) {
    return {
      status: 'up-to-date',
      currentVersion,
      latestVersion: manifest.version,
      channel: manifest.channel,
    }
  }

  if (req.check) {
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

    await extractTarGz(archive, tmp)
    const nextBin = join(tmp, 'astrale')
    await chmod(nextBin, 0o755)
    await smokeVersion(nextBin, manifest.binaryVersion ?? manifest.version)

    const previous = `${meta.bin}.previous`
    const staged = `${meta.bin}.next`
    await copyFile(meta.bin, previous).catch(() => undefined)
    await copyFile(nextBin, staged)
    await chmod(staged, 0o755)
    await rename(staged, meta.bin)

    await writeInstallMetadata(
      {
        ...meta,
        channel: manifest.channel,
        version: manifest.version,
        installedAt: new Date().toISOString(),
      },
      req.installPath,
    )

    return {
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

async function readUrlText(url: string): Promise<string> {
  if (url.startsWith('file://')) {
    return readFile(new URL(url), 'utf8')
  }
  const res = await fetch(url)
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

async function extractTarGz(archive: string, cwd: string): Promise<void> {
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
