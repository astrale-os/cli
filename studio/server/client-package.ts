import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXTRACTOR = fileURLToPath(new URL('./client-package-extractor.ts', import.meta.url))
const OUTPUT_PREFIX = '__ASTRALE_STUDIO_CLIENT_PACKAGE__'
const CACHE_TTL_MS = 30_000
const PROBE_TIMEOUT_MS = 10_000

export type ClientPackageResolution =
  | {
      status: 'available'
      dir: string
      packageFile: string
      devScript?: string
      source: 'adapter' | 'convention'
    }
  | { status: 'unavailable'; reason: string }

interface CacheEntry {
  fingerprint: string
  expiresAt: number
  packageFile?: string
  value: Promise<ClientPackageResolution>
}

const cache = new Map<string, CacheEntry>()

export async function resolveClientPackage(
  root: string,
  force = false,
): Promise<ClientPackageResolution> {
  const projectDir = resolve(root)
  const previous = cache.get(projectDir)
  const fingerprint = inputFingerprint(projectDir, previous?.packageFile)
  if (
    !force &&
    previous &&
    previous.fingerprint === fingerprint &&
    previous.expiresAt > Date.now()
  ) {
    return previous.value
  }

  const value = probeClientPackage(projectDir)
  const entry: CacheEntry = {
    fingerprint,
    expiresAt: Date.now() + CACHE_TTL_MS,
    value,
  }
  cache.set(projectDir, entry)
  const resolved = await value
  if (resolved.status === 'available') entry.packageFile = resolved.packageFile
  entry.fingerprint = inputFingerprint(projectDir, entry.packageFile)
  return resolved
}

export function invalidateClientPackage(root: string): void {
  cache.delete(resolve(root))
}

async function probeClientPackage(projectDir: string): Promise<ClientPackageResolution> {
  const configPath = join(projectDir, 'astrale.config.ts')
  if (!existsSync(configPath)) return conventionalClient(projectDir)

  try {
    const proc = Bun.spawn(['bun', 'run', EXTRACTOR, configPath, projectDir, 'dev'], {
      cwd: projectDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill(9)
    }, PROBE_TIMEOUT_MS)
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]).finally(() => clearTimeout(timer))
    const resultLine = stdout.split(/\r?\n/).findLast((line) => line.startsWith(OUTPUT_PREFIX))
    if (!resultLine) {
      return unavailable(
        (timedOut ? `The adapter client probe timed out after ${PROBE_TIMEOUT_MS}ms.` : '') ||
          stderr.trim() ||
          (exitCode === 0
            ? 'The adapter client probe produced no output.'
            : `The adapter client probe exited with code ${exitCode}.`),
      )
    }
    const result = JSON.parse(resultLine.slice(OUTPUT_PREFIX.length)) as {
      ok?: boolean
      supported?: boolean
      adapterName?: string
      dir?: string | null
      error?: string
    }
    if (!result.ok) return unavailable(`Could not inspect astrale.config.ts: ${result.error}`)
    if (!result.supported) {
      const fallback = conventionalClient(projectDir)
      if (fallback.status === 'available') return fallback
      return unavailable(
        `Adapter "${result.adapterName ?? 'unknown'}" does not expose its local client package.`,
      )
    }
    if (!result.dir) {
      return unavailable('The dev adapter environment has no client package configured.')
    }
    const dir = isAbsolute(result.dir) ? result.dir : resolve(projectDir, result.dir)
    return validateClientPackage(dir, 'adapter')
  } catch (error) {
    return unavailable(
      `Could not inspect astrale.config.ts: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function conventionalClient(projectDir: string): ClientPackageResolution {
  const dir = join(projectDir, 'client')
  if (!existsSync(join(dir, 'package.json'))) {
    return unavailable('This domain has no client package to run locally.')
  }
  return validateClientPackage(dir, 'convention')
}

function validateClientPackage(
  dir: string,
  source: 'adapter' | 'convention',
): ClientPackageResolution {
  const packageFile = join(dir, 'package.json')
  if (!existsSync(packageFile)) {
    return unavailable(`The configured client package has no package.json: ${dir}`)
  }
  try {
    const pkg = JSON.parse(readFileSync(packageFile, 'utf8')) as {
      scripts?: Record<string, unknown>
    }
    const devScript = pkg.scripts?.['dev:hmr']
    return {
      status: 'available',
      dir,
      packageFile,
      ...(typeof devScript === 'string' ? { devScript } : {}),
      source,
    }
  } catch (error) {
    return unavailable(
      `Could not read ${packageFile}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function inputFingerprint(projectDir: string, packageFile?: string): string {
  return [
    fileFingerprint(join(projectDir, 'astrale.config.ts')),
    fileFingerprint(join(projectDir, 'package.json')),
    packageFile ? fileFingerprint(packageFile) : '',
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
