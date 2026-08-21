/**
 * store.ts — the gateway for Studio-owned persistence under
 * `<domain>/.domain-studio/`. It rejects every target outside that directory.
 * Explicit user-requested domain edits (for example environment files or
 * workspace creation) belong to their own feature boundary, not this state store.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { parseJson, type JsonDecoder } from '../json'

export const DOT = '.domain-studio'

export function dotDir(domainRoot: string): string {
  return join(domainRoot, DOT)
}

function assertInsideDot(domainRoot: string, target: string): string {
  const abs = resolve(target)
  const root = resolve(dotDir(domainRoot))
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`state-allowlist violation: ${abs} is outside ${root}`)
  }

  // Lexical containment alone is insufficient: an existing `.domain-studio`
  // symlink (or any symlink below it) could otherwise redirect an allowed path
  // outside the state directory. Resolve every existing prefix against the
  // physical domain root. Resolving domainRoot first intentionally permits the
  // domain root itself to be a symlink.
  let physicalDomainRoot: string
  try {
    physicalDomainRoot = realpathSync(domainRoot)
  } catch {
    physicalDomainRoot = resolve(domainRoot)
  }
  const physicalRoot = resolve(physicalDomainRoot, DOT)
  const relativeTarget = relative(root, abs)
  const parts = relativeTarget === '' ? [] : relativeTarget.split(sep)
  let prefix = root
  for (const part of ['', ...parts]) {
    if (part) prefix = join(prefix, part)
    try {
      lstatSync(prefix)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') break
      throw error
    }

    let physicalPrefix: string
    try {
      physicalPrefix = realpathSync(prefix)
    } catch {
      throw new Error(`state-allowlist violation: ${prefix} is an unresolved symlink`)
    }
    if (physicalPrefix !== physicalRoot && !physicalPrefix.startsWith(physicalRoot + sep)) {
      throw new Error(`state-allowlist violation: ${prefix} resolves outside ${physicalRoot}`)
    }
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
  const target = assertInsideDot(domainRoot, join(dotDir(domainRoot), subpath))
  if (!existsSync(target)) return null
  return readFileSync(target, 'utf8')
}

export function readJson<T>(
  domainRoot: string,
  subpath: string,
  decode: JsonDecoder<T>,
  fallback: T,
): T {
  const raw = readState(domainRoot, subpath)
  if (raw == null) return fallback
  const parsed = parseJson(raw)
  if (parsed === undefined) return fallback
  return decode(parsed) ?? fallback
}

export function listState(domainRoot: string, subpath: string): string[] {
  const target = assertInsideDot(domainRoot, join(dotDir(domainRoot), subpath))
  if (!existsSync(target)) return []
  return readdirSync(target)
}

export function removeState(domainRoot: string, subpath: string): void {
  const target = join(dotDir(domainRoot), subpath)
  const abs = assertInsideDot(domainRoot, target)
  if (existsSync(abs)) rmSync(abs, { recursive: true, force: true })
}

export function stateExists(domainRoot: string, subpath: string): boolean {
  return existsSync(assertInsideDot(domainRoot, join(dotDir(domainRoot), subpath)))
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
