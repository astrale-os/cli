import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { UI_LOCK_FILE, UI_PACKAGE, UI_PRESETS, UI_REPOSITORY, UiError, type UiLock } from './model'

export function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function parseUiLock(value: unknown): UiLock {
  const lock = value as Partial<UiLock> | null
  if (
    !lock ||
    lock.version !== 1 ||
    lock.package?.name !== UI_PACKAGE ||
    typeof lock.package.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(lock.package.version) ||
    lock.registry?.repository !== UI_REPOSITORY ||
    lock.registry.ref !== 'v' + lock.package.version ||
    !/^[0-9a-f]{40}$/u.test(lock.registry.commit ?? '') ||
    typeof lock.tooling?.shadcn !== 'string' ||
    !/^\d+\.\d+\.\d+$/u.test(lock.tooling.shadcn) ||
    lock.tooling.base !== 'base' ||
    lock.tooling.style !== 'nova' ||
    typeof lock.tooling.baseUi !== 'string' ||
    !/^\d+\.\d+\.\d+$/u.test(lock.tooling.baseUi) ||
    !UI_PRESETS.includes(lock.preset as (typeof UI_PRESETS)[number]) ||
    !lock.items ||
    !isRecord(lock.items)
  ) {
    throw new UiError('UI_LOCK_INVALID', UI_LOCK_FILE + ' is structurally invalid.')
  }
  for (const [address, item] of Object.entries(lock.items)) {
    if (
      !/^(?:pattern|block)\/[a-z0-9-]+\/[a-z0-9-/]+$/u.test(address) ||
      !isRecord(item) ||
      item.address !== address ||
      !isDigest(item.sourceDigest) ||
      !isRecord(item.files)
    ) {
      throw new UiError('UI_LOCK_INVALID', UI_LOCK_FILE + ' contains an invalid item record.')
    }
    for (const [file, expected] of Object.entries(item.files)) {
      if (!isSafeRelative(file) || !isDigest(expected)) {
        throw new UiError('UI_LOCK_INVALID', UI_LOCK_FILE + ' contains an unsafe file record.')
      }
    }
  }
  return lock as UiLock
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
}

function isSafeRelative(value: string): boolean {
  return (
    value.length > 0 &&
    !pathIsAbsolute(value) &&
    !value.split(/[\\/]/u).includes('..') &&
    !value.includes('\\')
  )
}

function pathIsAbsolute(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value)
}

export async function readUiLock(target: string): Promise<UiLock> {
  try {
    return parseUiLock(JSON.parse(await readFile(target, 'utf8')))
  } catch (cause) {
    if (cause instanceof UiError) throw cause
    throw new UiError(
      'UI_CONFIG_MISSING',
      'Unable to read ' + UI_LOCK_FILE + '.',
      'Run astrale ui init.',
      { cause },
    )
  }
}
