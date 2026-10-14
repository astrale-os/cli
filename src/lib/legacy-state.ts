import { readFile, writeFile } from 'node:fs/promises'

import { paths } from '../state'
import { atomicWrite, withFileLock } from '../state/files'
import { upgradeUnversionedIdentityState } from '../state/identities'
import { upgradeUnversionedInstanceState } from './instance/bookmarks'
import { log } from './terminal/log'

/**
 * Releases before the V1 format label wrote `identities.json` and `instances.json` without
 * `version`. The registries admit only V1, so every invocation first upgrades such a file in place,
 * once, under that registry's lock, keeping its exact prior bytes beside it. A file that cannot be
 * converted is left untouched for its registry to refuse. Delete this module once no pre-V1
 * installation remains.
 */
const REGISTRIES = [
  { path: () => paths.identities, upgrade: upgradeUnversionedIdentityState },
  { path: () => paths.instances, upgrade: upgradeUnversionedInstanceState },
] as const

export async function upgradeUnversionedState(): Promise<void> {
  for (const registry of REGISTRIES) {
    const path = registry.path()
    const backup = await upgradeFile(path, registry.upgrade).catch(() => undefined)
    if (backup) log.warn(`Upgraded ${path} to the current format; the previous file is ${backup}.`)
  }
}

/** Upgrade one registry and return its backup path, or undefined when nothing was upgraded. */
export async function upgradeFile(
  path: string,
  upgrade: (raw: string) => string | undefined,
): Promise<string | undefined> {
  // Only a pre-V1 file pays for the lock; current and missing files return here.
  const current = await readFile(path, 'utf8').catch((error: { code?: string }) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (current === undefined || upgradeable(current, upgrade) === undefined) return undefined
  return withFileLock(`${path}.lock`, async () => {
    const raw = await readFile(path, 'utf8')
    const next = upgradeable(raw, upgrade)
    if (next === undefined) return undefined
    const backup = await preserve(path, raw)
    await atomicWrite(path, next)
    return backup
  })
}

function upgradeable(raw: string, upgrade: (raw: string) => string | undefined) {
  try {
    return upgrade(raw)
  } catch {
    return undefined
  }
}

/** Keep the exact prior bytes at `<path>.v0.bak`, never overwriting a different earlier backup. */
async function preserve(path: string, raw: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const backup = attempt === 0 ? `${path}.v0.bak` : `${path}.v0.${attempt}.bak`
    try {
      await writeFile(backup, raw, { flag: 'wx', mode: 0o600 })
      return backup
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error
      if ((await readFile(backup, 'utf8')) === raw) return backup
    }
  }
}
