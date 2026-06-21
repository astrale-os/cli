/**
 * store.ts — the ONLY filesystem-write gateway in the studio. It REJECTS any
 * write whose resolved path is not under `<domain>/.domain-studio/`. This makes
 * the read-only-domain rule a code-enforced invariant (§17 of the spec): the
 * studio can never write domain source. Reads of domain source are allowed and
 * done elsewhere; this module never writes outside the dotted folder.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

export const DOT = '.domain-studio'

export function dotDir(domainRoot: string): string {
  return join(domainRoot, DOT)
}

function assertInsideDot(domainRoot: string, target: string): string {
  const abs = resolve(target)
  const root = resolve(dotDir(domainRoot))
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`write-allowlist violation: ${abs} is outside ${root}`)
  }
  return abs
}

export function ensureDir(domainRoot: string, subpath = ''): string {
  const target = subpath ? join(dotDir(domainRoot), subpath) : dotDir(domainRoot)
  assertInsideDot(domainRoot, target)
  mkdirSync(target, { recursive: true })
  return target
}

export function writeState(domainRoot: string, subpath: string, contents: string): void {
  const target = join(dotDir(domainRoot), subpath)
  const abs = assertInsideDot(domainRoot, target)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, contents)
}

export function writeJson(domainRoot: string, subpath: string, value: unknown): void {
  writeState(domainRoot, subpath, JSON.stringify(value, null, 2))
}

/** Binary write (e.g. dropped documents), allow-listed to the dotted folder. */
export function writeStateBuffer(domainRoot: string, subpath: string, data: Uint8Array): void {
  const target = join(dotDir(domainRoot), subpath)
  const abs = assertInsideDot(domainRoot, target)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, data)
}

/** Absolute path of a state file (allow-listed) — for reading/serving. */
export function statePath(domainRoot: string, subpath: string): string {
  return assertInsideDot(domainRoot, join(dotDir(domainRoot), subpath))
}

export function readState(domainRoot: string, subpath: string): string | null {
  const target = join(dotDir(domainRoot), subpath)
  if (!existsSync(target)) return null
  return readFileSync(target, 'utf8')
}

export function readJson<T>(domainRoot: string, subpath: string, fallback: T): T {
  const raw = readState(domainRoot, subpath)
  if (raw == null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function listState(domainRoot: string, subpath: string): string[] {
  const target = join(dotDir(domainRoot), subpath)
  if (!existsSync(target)) return []
  return readdirSync(target)
}

export function removeState(domainRoot: string, subpath: string): void {
  const target = join(dotDir(domainRoot), subpath)
  const abs = assertInsideDot(domainRoot, target)
  if (existsSync(abs)) rmSync(abs, { recursive: true, force: true })
}

export function stateExists(domainRoot: string, subpath: string): boolean {
  return existsSync(join(dotDir(domainRoot), subpath))
}

/** Initialise the dotted folder skeleton + a .cache/.gitignore (never touches the user's root .gitignore). */
export function initDotDir(domainRoot: string): void {
  ensureDir(domainRoot)
  ensureDir(domainRoot, 'context/user')
  ensureDir(domainRoot, 'context/auto')
  ensureDir(domainRoot, '.cache')
  if (!stateExists(domainRoot, '.cache/.gitignore'))
    writeState(domainRoot, '.cache/.gitignore', '*\n')
}
