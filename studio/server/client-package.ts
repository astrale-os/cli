import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

import { asJsonRecord, asStringArray, parseJson } from './json'

export type ClientPackageResolution =
  | {
      status: 'available'
      packageDir: string
      sourceDir: string
      packageFile: string
      devScript: string
      source: 'root' | 'workspace'
    }
  | { status: 'unavailable'; reason: string }

interface CacheEntry {
  fingerprint: string
  value: ClientPackageResolution
}

interface PackageManifest {
  scripts?: Record<string, unknown>
  workspaces?: string[] | { packages?: string[] }
}

interface PreviewPackage {
  packageDir: string
  packageFile: string
  devScript: string
}

interface DiscoveryInputs {
  packageFiles: string[]
  rootPackage?: PackageManifest
  error?: string
}

const cache = new Map<string, CacheEntry>()

export async function resolveClientPackage(
  root: string,
  force = false,
): Promise<ClientPackageResolution> {
  const projectDir = resolve(root)
  const inputs = discoverInputs(projectDir)
  if (inputs.error) return unavailable(inputs.error)

  const fingerprint = inputFingerprint(projectDir, inputs.packageFiles)
  const previous = cache.get(projectDir)
  if (!force && previous?.fingerprint === fingerprint) {
    return previous.value
  }

  const value = resolveDiscovery(projectDir, inputs.rootPackage, inputs.packageFiles)
  const entry: CacheEntry = {
    fingerprint,
    value,
  }
  cache.set(projectDir, entry)
  return value
}

export function invalidateClientPackage(root: string): void {
  cache.delete(resolve(root))
}

function discoverInputs(projectDir: string): DiscoveryInputs {
  const rootPackageFile = join(projectDir, 'package.json')
  let rootPackage: PackageManifest | undefined
  try {
    if (existsSync(rootPackageFile)) rootPackage = readPackage(rootPackageFile)
  } catch (error) {
    const reason = `Could not read ${rootPackageFile}: ${errorMessage(error)}`
    return { packageFiles: [rootPackageFile], error: reason }
  }

  try {
    const packageFiles = discoverPackageFiles(projectDir, rootPackage)
    return {
      packageFiles: [...new Set([rootPackageFile, ...packageFiles])],
      rootPackage,
    }
  } catch (error) {
    const reason = `Could not discover domain workspace packages: ${errorMessage(error)}`
    return { packageFiles: [rootPackageFile], error: reason }
  }
}

function resolveDiscovery(
  projectDir: string,
  rootPackage: PackageManifest | undefined,
  inspectedFiles: string[],
): ClientPackageResolution {
  const rootPackageFile = join(projectDir, 'package.json')
  const candidates: PreviewPackage[] = []
  for (const packageFile of inspectedFiles) {
    if (packageFile === rootPackageFile) continue
    try {
      const devScript = previewScript(readPackage(packageFile))
      if (devScript) {
        candidates.push({ packageDir: resolve(packageFile, '..'), packageFile, devScript })
      }
    } catch (error) {
      return unavailable(`Could not read ${packageFile}: ${errorMessage(error)}`)
    }
  }

  const rootScript = previewScript(rootPackage)
  if (rootScript) {
    return {
      status: 'available',
      packageDir: projectDir,
      sourceDir: projectDir,
      packageFile: rootPackageFile,
      devScript: rootScript,
      source: 'root',
    }
  }

  if (candidates.length === 1) {
    const candidate = candidates[0]!
    return {
      status: 'available',
      ...candidate,
      sourceDir: candidate.packageDir,
      source: 'workspace',
    }
  }

  if (candidates.length > 1) {
    const names = candidates
      .map((candidate) => relative(projectDir, candidate.packageDir).replaceAll('\\', '/'))
      .sort()
      .join(', ')
    return unavailable(
      `Multiple packages define dev:hmr (${names}). Add a dev:hmr script to the domain root to choose one.`,
    )
  }

  return unavailable('This domain has no package that defines a dev:hmr script.')
}

function discoverPackageFiles(projectDir: string, rootPackage?: PackageManifest): string[] {
  const workspaceFile = join(projectDir, 'pnpm-workspace.yaml')
  const patterns = [...packageWorkspacePatterns(rootPackage)]
  if (existsSync(workspaceFile)) {
    const workspace = parseYaml(readFileSync(workspaceFile, 'utf8')) as {
      packages?: unknown
    } | null
    if (Array.isArray(workspace?.packages)) {
      patterns.push(
        ...workspace.packages.filter((value): value is string => typeof value === 'string'),
      )
    }
  }

  const includes = ['*/package.json']
  const excludes: string[] = []
  for (const pattern of patterns) {
    const raw = pattern.trim()
    const excluded = raw.startsWith('!')
    const normalized = normalizeWorkspacePattern(excluded ? raw.slice(1) : raw)
    if (!normalized) continue
    if (excluded) excludes.push(`${normalized}/package.json`)
    else includes.push(`${normalized}/package.json`)
  }

  const excludedGlobs = excludes.map((pattern) => new Bun.Glob(pattern))
  const files = new Set<string>()
  for (const pattern of includes) {
    const glob = new Bun.Glob(pattern)
    for (const file of glob.scanSync({ cwd: projectDir, onlyFiles: true })) {
      const normalized = file.replaceAll('\\', '/')
      if (isIgnoredPackagePath(normalized)) continue
      if (excludedGlobs.some((excluded) => excluded.match(normalized))) continue
      const absolute = resolve(projectDir, normalized)
      if (inside(projectDir, absolute)) files.add(absolute)
    }
  }

  return [...files].sort()
}

function normalizeWorkspacePattern(pattern: string): string | undefined {
  const normalized = pattern.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (!normalized || normalized === '.' || isAbsolute(normalized)) return undefined
  if (normalized.split('/').includes('..')) return undefined
  return normalized
}

function isIgnoredPackagePath(path: string): boolean {
  const segments = path.split('/')
  return segments.includes('node_modules') || segments.includes('.git')
}

function packageWorkspacePatterns(pkg?: PackageManifest): string[] {
  const workspaces = Array.isArray(pkg?.workspaces)
    ? pkg.workspaces
    : Array.isArray(pkg?.workspaces?.packages)
      ? pkg.workspaces.packages
      : []
  return workspaces.filter((value): value is string => typeof value === 'string')
}

function readPackage(packageFile: string): PackageManifest {
  const record = asJsonRecord(parseJson(readFileSync(packageFile, 'utf8')))
  if (!record) throw new TypeError('package.json must contain an object')
  const scriptsRecord = asJsonRecord(record.scripts)
  const scripts = scriptsRecord
    ? Object.fromEntries(
        Object.entries(scriptsRecord).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : undefined
  let workspaces: PackageManifest['workspaces']
  const workspaceList = asStringArray(record.workspaces)
  if (workspaceList) {
    workspaces = workspaceList
  } else {
    const workspaceObject = asJsonRecord(record.workspaces)
    const packages = asStringArray(workspaceObject?.packages)
    if (workspaceObject) workspaces = packages ? { packages } : {}
  }
  return {
    ...(scripts === undefined ? {} : { scripts }),
    ...(workspaces === undefined ? {} : { workspaces }),
  }
}

function previewScript(pkg?: PackageManifest): string | undefined {
  const script = pkg?.scripts?.['dev:hmr']
  return typeof script === 'string' && script.trim() ? script : undefined
}

function inside(root: string, file: string): boolean {
  const path = relative(root, file)
  return path !== '..' && !path.startsWith('../') && !path.startsWith('..\\')
}

function inputFingerprint(projectDir: string, packageFiles: string[]): string {
  return [
    fileFingerprint(projectDir),
    fileFingerprint(join(projectDir, 'pnpm-workspace.yaml')),
    ...packageFiles.map(fileFingerprint),
  ].join('|')
}

function fileFingerprint(path: string): string {
  try {
    const stat = statSync(path)
    return `${path}:${stat.size}:${stat.mtimeMs}`
  } catch {
    return `${path}:missing`
  }
}

function unavailable(reason: string): ClientPackageResolution {
  return { status: 'unavailable', reason }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
