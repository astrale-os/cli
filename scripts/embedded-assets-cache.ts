import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'

const CACHE_FORMAT = 1
const CACHE_DIRECTORY = join('node_modules', '.cache', 'astrale-cli')
const CACHE_FILE = 'embedded-assets.json'
const LOCK_DIRECTORY = 'embedded-assets.lock'
const OUTPUT = join('src', 'generated', 'embedded-assets.ts')
const LOCK_STALE_MS = 5 * 60_000
const LOCK_WAIT_MS = 2 * 60_000

type CacheRecord = {
  format: typeof CACHE_FORMAT
  inputDigest: string
  outputDigest: string
}

const DIRECTORY_INPUTS = [
  { path: 'skills', excludedDirectories: new Set<string>() },
  { path: join('studio', 'client'), excludedDirectories: new Set(['dist']) },
  { path: join('studio', 'shared'), excludedDirectories: new Set<string>() },
] as const

const FILE_INPUTS = [
  '.bun-version',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  join('scripts', 'build-embedded-assets.ts'),
  join('scripts', 'build-viewer.ts'),
  join('scripts', 'embedded-assets-cache.ts'),
  join('scripts', 'generate-embedded-assets.ts'),
  join('studio', 'package.json'),
  join('studio', 'tsconfig.json'),
  join('studio', 'vite.config.ts'),
  join('viewer', 'index.html'),
  join('viewer', 'tsconfig.json'),
] as const

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json', '.css']

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

async function pathStat(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

async function collectDirectoryFiles(
  directory: string,
  files: Set<string>,
  excludedDirectories: ReadonlySet<string>,
): Promise<void> {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        await collectDirectoryFiles(path, files, excludedDirectories)
      }
      continue
    }
    files.add(path)
  }
}

function transpilerLoader(path: string): 'ts' | 'tsx' | 'js' | 'jsx' | undefined {
  switch (extname(path)) {
    case '.ts':
    case '.mts':
      return 'ts'
    case '.tsx':
      return 'tsx'
    case '.js':
    case '.mjs':
      return 'js'
    case '.jsx':
      return 'jsx'
    default:
      return undefined
  }
}

async function resolveRelativeModule(importer: string, specifier: string): Promise<string> {
  const clean = specifier.split(/[?#]/u, 1)[0]!
  const base = resolve(dirname(importer), clean)
  const extension = extname(base)
  const candidates = extension
    ? [
        base,
        ...(extension === '.js' || extension === '.mjs'
          ? [base.slice(0, -extension.length) + '.ts', base.slice(0, -extension.length) + '.tsx']
          : []),
      ]
    : [
        base,
        ...MODULE_EXTENSIONS.map((candidate) => base + candidate),
        ...MODULE_EXTENSIONS.map((candidate) => join(base, `index${candidate}`)),
      ]
  for (const candidate of candidates) {
    if ((await pathStat(candidate))?.isFile()) return candidate
  }
  throw new Error(
    `could not resolve embedded viewer import ${JSON.stringify(specifier)} from ${importer}`,
  )
}

async function collectViewerModuleGraph(root: string, files: Set<string>): Promise<void> {
  const pending = [join(root, 'viewer', 'main.ts')]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    files.add(current)
    const loader = transpilerLoader(current)
    if (!loader) continue
    const source = await readFile(current, 'utf8')
    const imports = new Bun.Transpiler({ loader }).scan(source).imports
    for (const imported of imports) {
      if (!imported.path.startsWith('.')) continue
      const resolved = await resolveRelativeModule(current, imported.path)
      repositoryPath(root, resolved)
      pending.push(resolved)
    }
  }
}

function repositoryPath(root: string, path: string): string {
  const value = relative(root, path)
  if (value === '..' || value.startsWith('../') || value.startsWith('..\\') || isAbsolute(value)) {
    throw new Error(`embedded asset input escapes the repository: ${path}`)
  }
  return value.split('\\').join('/')
}

async function fileDigest(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

export function embeddedAssetOutput(root: string): string {
  return join(root, OUTPUT)
}

function cachePath(root: string): string {
  return join(root, CACHE_DIRECTORY, CACHE_FILE)
}

function lockPath(root: string): string {
  return join(root, CACHE_DIRECTORY, LOCK_DIRECTORY)
}

export async function embeddedAssetInputDigest(root: string): Promise<string> {
  const files = new Set<string>()
  for (const input of FILE_INPUTS) files.add(join(root, input))
  for (const input of DIRECTORY_INPUTS) {
    await collectDirectoryFiles(join(root, input.path), files, input.excludedDirectories)
  }
  await collectViewerModuleGraph(root, files)

  const hash = createHash('sha256')
  hash.update(`astrale-embedded-assets-cache-v${CACHE_FORMAT}\0bun-${Bun.version}\0`)
  for (const path of [...files].sort((left, right) => {
    const leftPath = repositoryPath(root, left)
    const rightPath = repositoryPath(root, right)
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0
  })) {
    const metadata = await lstat(path)
    hash.update(repositoryPath(root, path))
    hash.update('\0')
    hash.update(metadata.isSymbolicLink() ? 'link' : `file-${metadata.mode & 0o111}`)
    hash.update('\0')
    hash.update(metadata.isSymbolicLink() ? await readlink(path) : await readFile(path))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function readCacheRecord(root: string): Promise<CacheRecord | undefined> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(root), 'utf8')) as Partial<CacheRecord>
    if (
      parsed.format !== CACHE_FORMAT ||
      typeof parsed.inputDigest !== 'string' ||
      typeof parsed.outputDigest !== 'string'
    ) {
      return undefined
    }
    return parsed as CacheRecord
  } catch {
    return undefined
  }
}

export async function embeddedAssetCacheIsCurrent(
  root: string,
  inputDigest: string,
): Promise<boolean> {
  const record = await readCacheRecord(root)
  const output = embeddedAssetOutput(root)
  if (!record || record.inputDigest !== inputDigest || !(await pathStat(output))?.isFile()) {
    return false
  }
  return (await fileDigest(output)) === record.outputDigest
}

export async function writeEmbeddedAssetCache(root: string, inputDigest: string): Promise<void> {
  const path = cachePath(root)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const record: CacheRecord = {
    format: CACHE_FORMAT,
    inputDigest,
    outputDigest: await fileDigest(embeddedAssetOutput(root)),
  }
  try {
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`)
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

export async function withEmbeddedAssetLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const cacheDirectory = join(root, CACHE_DIRECTORY)
  const lock = lockPath(root)
  await mkdir(cacheDirectory, { recursive: true })
  const deadline = Date.now() + LOCK_WAIT_MS
  while (true) {
    try {
      await mkdir(lock)
      break
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      const lockMetadata = await stat(lock).catch(() => undefined)
      if (lockMetadata && Date.now() - lockMetadata.mtimeMs > LOCK_STALE_MS) {
        await rm(lock, { recursive: true, force: true })
        continue
      }
      if (Date.now() >= deadline) throw new Error('timed out waiting for embedded asset generation')
      await Bun.sleep(100)
    }
  }
  try {
    return await action()
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}
