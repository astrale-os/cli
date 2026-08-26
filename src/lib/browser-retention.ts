/**
 * Browser-profile retention.
 *
 * `astrale browser` keeps one persistent Chromium profile per host so the
 * WorkOS cookie survives between runs. That cookie is a few kilobytes;
 * everything Chromium accumulates around it is cache, and it accumulates
 * without limit — a real profile here reached 373 MB, 98% of it cache.
 *
 * Chromium will not bound it for us. `--disk-cache-size` is measurably ignored
 * for a profile's HTTP cache — the largest component by far — so deleting is
 * the only lever. Two rules, cheapest first:
 *
 *   1. A profile untouched for longer than the age bound goes entirely. Its
 *      WorkOS cookie has expired anyway, so it holds nothing worth the disk.
 *   2. A surviving profile whose cache exceeds the size bound has its cache
 *      directories removed. Cookies, Local Storage, Preferences and Local State
 *      are never touched — the whole point of the profile is that the session
 *      outlives the sweep.
 *
 * A profile whose SingletonLock names a live process is always left alone:
 * deleting files under a running Chromium is how profiles get corrupted.
 */
import { readlinkSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { BROWSER_DIR } from './browser'
import { readConfig } from './config'

/** Reconstructible directories, relative to a profile root. Everything here can
 *  be deleted with no user-visible consequence beyond a colder first load. */
const CACHE_PATHS = [
  'Default/Cache',
  'Default/Code Cache',
  'Default/GPUCache',
  'Default/DawnWebGPUCache',
  'Default/DawnGraphiteCache',
  'Default/Service Worker/CacheStorage',
  'Default/Service Worker/ScriptCache',
  'GraphiteDawnCache',
  'GPUPersistentCache',
  'GrShaderCache',
  'ShaderCache',
  'component_crx_cache',
  'extensions_crx_cache',
] as const

export const DEFAULT_MAX_CACHE_BYTES = 50 * 1024 * 1024
export const DEFAULT_MAX_PROFILE_AGE_DAYS = 30

export type BrowserRetentionBudget = {
  /** Cap on one profile's cache directories, not on the profile as a whole. */
  maxCacheBytes: number
  maxProfileAgeMs: number
}

export type BrowserSweepResult = {
  /** Profiles deleted outright (dormant past the age bound). */
  removed: string[]
  /** Profiles kept, cache emptied (over the size bound). */
  purged: string[]
  /** Profiles a live browser was holding — left untouched. */
  skipped: string[]
  bytesFreed: number
}

const EMPTY: BrowserSweepResult = { removed: [], purged: [], skipped: [], bytesFreed: 0 }

/** First finite, strictly positive candidate; anything else falls through to
 *  the next one, and ultimately to the default. A typo must not mean "no cap". */
function firstPositive(candidates: (number | string | undefined)[]): number | null {
  for (const candidate of candidates) {
    if (candidate === undefined) continue
    const n = typeof candidate === 'string' ? Number(candidate.trim()) : candidate
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

/** Resolved budget: env over config over defaults. */
export async function browserRetentionBudget(): Promise<BrowserRetentionBudget> {
  const browser = (await readConfig().catch(() => null))?.browser
  const bytes =
    firstPositive([process.env.ASTRALE_BROWSER_MAX_CACHE_BYTES, browser?.maxCacheBytes]) ??
    DEFAULT_MAX_CACHE_BYTES
  const days =
    firstPositive([process.env.ASTRALE_BROWSER_MAX_PROFILE_AGE_DAYS, browser?.maxProfileAgeDays]) ??
    DEFAULT_MAX_PROFILE_AGE_DAYS
  return { maxCacheBytes: bytes, maxProfileAgeMs: days * 24 * 60 * 60 * 1000 }
}

/** True when a process with this pid exists. EPERM means it exists but is not
 *  ours — still alive, and still a reason not to touch the profile. */
function isLive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Whether a live browser holds this profile. SingletonLock is a symlink whose
 * target is `<hostname>-<pid>` and which does NOT resolve to a real file, so it
 * must be read with readlink, never stat'ed. A stale lock (dead pid) is not a
 * reason to skip — Chromium leaves those behind after a crash.
 */
export function heldByLiveBrowser(profileDir: string): boolean {
  let target: string
  try {
    target = readlinkSync(join(profileDir, 'SingletonLock'))
  } catch {
    return false
  }
  const pid = Number(target.slice(target.lastIndexOf('-') + 1))
  return Number.isInteger(pid) && pid > 0 && isLive(pid)
}

/** Bytes under `dir`, or 0 when it is missing or unreadable. */
async function directoryBytes(dir: string): Promise<number> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await directoryBytes(path)
    } else if (entry.isFile()) {
      try {
        total += (await stat(path)).size
      } catch {
        /* raced away mid-walk */
      }
    }
  }
  return total
}

/** Cumulative size of one profile's cache directories. */
export async function profileCacheBytes(profileDir: string): Promise<number> {
  let total = 0
  for (const relative of CACHE_PATHS) total += await directoryBytes(join(profileDir, relative))
  return total
}

/** Delete every cache directory of a profile; returns bytes actually freed. */
async function purgeCache(profileDir: string): Promise<number> {
  const before = await profileCacheBytes(profileDir)
  for (const relative of CACHE_PATHS) {
    await rm(join(profileDir, relative), { recursive: true, force: true }).catch(() => {
      /* best effort — retention must never break the browser command */
    })
  }
  return before - (await profileCacheBytes(profileDir))
}

/**
 * Apply both rules across every profile under `dir`. Never throws: a failed
 * sweep must not stop the user from driving a browser.
 */
export async function sweepBrowserProfiles(
  options: { dir?: string; budget?: BrowserRetentionBudget; now?: number } = {},
): Promise<BrowserSweepResult> {
  const dir = options.dir ?? BROWSER_DIR
  let names: string[]
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return EMPTY
  }
  if (names.length === 0) return EMPTY

  const budget = options.budget ?? (await browserRetentionBudget())
  const now = options.now ?? Date.now()
  const result: BrowserSweepResult = { removed: [], purged: [], skipped: [], bytesFreed: 0 }

  for (const name of names) {
    const profileDir = join(dir, name)
    if (heldByLiveBrowser(profileDir)) {
      result.skipped.push(name)
      continue
    }
    try {
      // The profile root's mtime tracks USE, not writes: Chromium rewrites
      // SingletonLock and DevToolsActivePort there on every launch, while cache
      // writes land in subdirectories and leave the root alone.
      const idleMs = now - (await stat(profileDir)).mtime.getTime()
      if (idleMs > budget.maxProfileAgeMs) {
        result.bytesFreed += await directoryBytes(profileDir)
        await rm(profileDir, { recursive: true, force: true })
        result.removed.push(name)
        continue
      }
      if ((await profileCacheBytes(profileDir)) > budget.maxCacheBytes) {
        result.bytesFreed += await purgeCache(profileDir)
        result.purged.push(name)
      }
    } catch {
      /* best effort, per profile — one bad profile must not stop the sweep */
    }
  }
  return result
}
