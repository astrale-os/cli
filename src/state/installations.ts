import { issuer } from '@astrale-os/sdk/auth'
import { constants } from 'node:fs'
import { access, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

import { readPrivateStore, updatePrivateStore, type FileLockOptions } from './files'
import { paths } from './paths'

const VERSION = 1
/**
 * A recorded issuer goes stale when a consented reinstall moves it; a stale one fails closed at
 * token exchange or Kernel admission, and its reader forgets it. The age only bounds how long an
 * unused entry lingers.
 */
const MAXIMUM_AGE_MS = 24 * 60 * 60 * 1_000
const MAXIMUM_ENTRIES = 256
/** A cache never makes a command wait: a busy lock turns a write into a miss or a file removal. */
const LOCK: FileLockOptions = Object.freeze({ timeoutMs: 1_000, pollIntervalMs: 25 })

/**
 * What the CLI remembers about one Domain installed on one Kernel.
 *
 * Only facts whose staleness fails closed belong here: a reinstall that moves the issuer makes a
 * stale record fail at token exchange or Kernel admission, and its reader then forgets it. Facts an
 * upgrade changes without failing (revision, bindings, readiness) need revalidation and must never
 * be served from this record.
 */
export interface Installation {
  /** Issuer the installed pin named when read, or null when the Domain executes on the Kernel. */
  readonly issuer: string | null
}

interface Entry extends Installation {
  /** Unix time in milliseconds of the installation read that produced this entry. */
  readonly observedAt: number
}

/**
 * Remember each Domain installation per source Kernel.
 *
 * The record is installation state, never authority: the Kernel still admits every credential the
 * CLI exchanges through its issuer. It lets a callable command, and the Shell exchange of a managed
 * Instance, skip reading the installation again.
 *
 * A record is trusted only while the cache can still forget it: a caller that finds it stale must
 * be able to evict it, or every later command would keep reusing it.
 */
export class InstallationCache {
  constructor(
    private readonly path = paths.installations,
    private readonly maximumAgeMs = MAXIMUM_AGE_MS,
    private readonly lock: FileLockOptions = LOCK,
  ) {}

  /** The remembered installation, or undefined when unknown. */
  async get(
    kernelIssuer: string,
    origin: string,
    now = Date.now(),
  ): Promise<Installation | undefined> {
    // Eviction needs a writable directory; without one an entry could never be forgotten.
    try {
      await access(dirname(this.path), constants.W_OK)
    } catch {
      return undefined
    }
    const entry = (await readPrivateStore<Entry>(this.path, VERSION))[
      encodeKey(kernelIssuer, origin)
    ]
    return entry !== undefined && validEntry(entry, now, this.maximumAgeMs)
      ? Object.freeze({ issuer: entry.issuer })
      : undefined
  }

  async set(
    kernelIssuer: string,
    origin: string,
    installation: Installation,
    now = Date.now(),
  ): Promise<void> {
    await this.transition((entries) => {
      for (const [encoded, entry] of Object.entries(entries)) {
        if (!validEntry(entry, now, this.maximumAgeMs)) delete entries[encoded]
      }
      const encoded = encodeKey(kernelIssuer, origin)
      delete entries[encoded]
      entries[encoded] = Object.freeze({ issuer: installation.issuer, observedAt: now })
      const keys = Object.keys(entries)
      for (const stale of keys.slice(0, Math.max(0, keys.length - MAXIMUM_ENTRIES))) {
        delete entries[stale]
      }
    })
  }

  /**
   * Forget one entry. When the store cannot be rewritten (no space, lock unavailable), remove the
   * whole file instead: unlinking needs neither, and a lost entry only costs one installation read.
   */
  async delete(kernelIssuer: string, origin: string): Promise<void> {
    try {
      await this.transition((entries) => {
        delete entries[encodeKey(kernelIssuer, origin)]
      })
    } catch (cause) {
      await rm(this.path, { force: true }).catch(() => {
        throw cause
      })
    }
  }

  async deleteKernel(kernelIssuer: string): Promise<void> {
    await this.transition((entries) => {
      for (const encoded of Object.keys(entries)) {
        if (decodeKernel(encoded) === kernelIssuer) delete entries[encoded]
      }
    })
  }

  private async transition(change: (entries: Record<string, Entry>) => void): Promise<void> {
    await updatePrivateStore<Entry, void>(
      this.path,
      VERSION,
      async (entries) => {
        change(entries)
        return { value: undefined, changed: true }
      },
      this.lock,
    )
  }
}

export const INSTALLATION_CACHE = new InstallationCache()

function validEntry(entry: Entry, now: number, maximumAgeMs: number): boolean {
  if (
    entry === null ||
    typeof entry !== 'object' ||
    Reflect.ownKeys(entry).length !== 2 ||
    !Number.isSafeInteger(entry.observedAt) ||
    entry.observedAt > now ||
    now - entry.observedAt >= maximumAgeMs
  ) {
    return false
  }
  if (entry.issuer === null) return true
  try {
    return typeof entry.issuer === 'string' && issuer.accept(entry.issuer) === entry.issuer
  } catch {
    return false
  }
}

function encodeKey(kernelIssuer: string, origin: string): string {
  return JSON.stringify([kernelIssuer, origin])
}

function decodeKernel(encoded: string): string | undefined {
  try {
    const value = JSON.parse(encoded) as unknown
    return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined
  } catch {
    return undefined
  }
}
