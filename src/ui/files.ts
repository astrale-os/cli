import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  )
}

export async function readOptional(target: string): Promise<string | undefined> {
  return readFile(target, 'utf8').catch(() => undefined)
}

/** SHA-256 of a file's bytes, or '' when it cannot be read. */
export async function fileDigest(target: string): Promise<string> {
  return readFile(target).then(sha256, () => '')
}

export async function writeJson(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

/** A forward-slash relative path that names no parent, no root, no query and no control byte. */
export function isSafeRelative(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:[\\/]/u.test(value) &&
    !value.includes('\\') &&
    !/[?#%]/u.test(value) &&
    ![...value].some(
      (character) => (character.codePointAt(0) ?? 0) <= 31 || character === '\x7f',
    ) &&
    value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  )
}

/** Whether `target` is `root` itself or below it. */
export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}

/**
 * Run `change` over `targets` and put back their exact prior contents (or absence) when it
 * throws.
 */
export async function withRollback<T>(targets: string[], change: () => Promise<T>): Promise<T> {
  const snapshots = new Map<string, string | undefined>()
  for (const target of targets) snapshots.set(target, await readOptional(target))
  try {
    return await change()
  } catch (error) {
    for (const [target, previous] of snapshots) {
      if (previous === undefined) await rm(target, { force: true })
      else await writeFile(target, previous, 'utf8')
    }
    throw error
  }
}
