import { readFile } from 'node:fs/promises'

import { isSafeRelative } from './files'
import {
  RELEASE_VERSION,
  UI_LOCK_FILE,
  UI_PACKAGE,
  UI_PRESETS,
  UI_REPOSITORY,
  UiError,
  isRecord,
  isSha256,
  type UiLock,
} from './model'

const ITEM_ADDRESS =
  /^(?:component\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*|(?:pattern|block)\/[a-z0-9-]+\/[a-z0-9-/]+|theme\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/u
const EXACT_VERSION = /^\d+\.\d+\.\d+$/u

function invalid(detail: string): UiError {
  return new UiError('UI_LOCK_INVALID', `${UI_LOCK_FILE} ${detail}.`)
}

export function parseUiLock(value: unknown): UiLock {
  const lock = value as Partial<UiLock> | null
  if (
    !lock ||
    lock.version !== 1 ||
    lock.package?.name !== UI_PACKAGE ||
    !RELEASE_VERSION.test(String(lock.package.version)) ||
    lock.registry?.repository !== UI_REPOSITORY ||
    lock.registry.ref !== 'v' + lock.package.version ||
    !/^[0-9a-f]{40}$/u.test(lock.registry.commit ?? '') ||
    !EXACT_VERSION.test(String(lock.tooling?.shadcn)) ||
    lock.tooling?.base !== 'base' ||
    lock.tooling.style !== 'nova' ||
    !EXACT_VERSION.test(String(lock.tooling.baseUi)) ||
    !UI_PRESETS.includes(lock.preset as (typeof UI_PRESETS)[number]) ||
    !isRecord(lock.items)
  ) {
    throw invalid('is structurally invalid')
  }
  for (const [address, item] of Object.entries(lock.items)) {
    if (
      !ITEM_ADDRESS.test(address) ||
      !isRecord(item) ||
      item.address !== address ||
      !isSha256(item.sourceDigest) ||
      !isRecord(item.files)
    ) {
      throw invalid('contains an invalid item record')
    }
    for (const [file, expected] of Object.entries(item.files)) {
      if (!isSafeRelative(file) || !isSha256(expected))
        throw invalid('contains an unsafe file record')
    }
  }
  return lock as UiLock
}

export async function readUiLock(target: string): Promise<UiLock> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(target, 'utf8'))
  } catch (cause) {
    throw new UiError(
      'UI_CONFIG_MISSING',
      `Unable to read ${UI_LOCK_FILE}.`,
      'Run astrale ui init.',
      {
        cause,
      },
    )
  }
  return parseUiLock(value)
}

/** The release a lock pins. */
export function lockedIdentity(lock: UiLock) {
  return { version: lock.package.version, ref: lock.registry.ref, commit: lock.registry.commit }
}
