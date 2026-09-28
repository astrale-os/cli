import { issuer } from '@astrale-os/sdk/auth'
import { constants } from 'node:fs'
import { access, chmod, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

import { atomicWrite, withFileLock, type FileLockOptions } from './files'
import { DOMAIN_ISSUERS_PATH } from './paths'

const VERSION = 1
/**
 * An installed Domain keeps its issuer until it is uninstalled, and a stale issuer fails closed at
 * token exchange or Kernel admission. The age only bounds how long an unused entry lingers.
 */
const MAXIMUM_AGE_MS = 24 * 60 * 60 * 1_000
const MAXIMUM_ENTRIES = 256
/** A cache never makes a command wait: a busy lock turns a write into a miss or a file removal. */
const LOCK: FileLockOptions = Object.freeze({ timeoutMs: 1_000, pollIntervalMs: 25 })

export namespace domainIssuers {
  export interface Artifact {
    readonly version: 1
    readonly entries: Record<string, Entry>
  }

  export interface Entry {
    /** Installed Domain issuer, or null when the Domain executes on the Kernel itself. */
    readonly issuer: string | null
    /** Unix time in milliseconds of the installation read that produced this entry. */
    readonly observedAt: number
  }
}

/**
 * Remember which issuer each installed Domain has on each source Kernel.
 *
 * The value is installation state, never authority: the Kernel still admits every credential the
 * CLI exchanges through it. It lets a callable command skip reading the installation again.
 *
 * A remembered issuer is trusted only while the cache can still forget it: a caller that finds it
 * stale must be able to evict it, or every later command would keep reusing it.
 */
export class DomainIssuerCache {
  constructor(
    private readonly path = DOMAIN_ISSUERS_PATH,
    private readonly maximumAgeMs = MAXIMUM_AGE_MS,
    private readonly lock: FileLockOptions = LOCK,
  ) {}

  /** The remembered issuer, `null` for a Kernel-hosted Domain, or undefined when unknown. */
  async get(
    kernelIssuer: string,
    origin: string,
    now = Date.now(),
  ): Promise<string | null | undefined> {
    // Eviction needs a writable directory; without one an entry could never be forgotten.
    try {
      await access(dirname(this.path), constants.W_OK)
    } catch {
      return undefined
    }
    const entry = (await readStore(this.path)).entries[encodeKey(kernelIssuer, origin)]
    return entry !== undefined && validEntry(entry, now, this.maximumAgeMs)
      ? entry.issuer
      : undefined
  }

  async set(
    kernelIssuer: string,
    origin: string,
    domainIssuer: string | null,
    now = Date.now(),
  ): Promise<void> {
    await this.transition((store) => {
      for (const [encoded, entry] of Object.entries(store.entries)) {
        if (!validEntry(entry, now, this.maximumAgeMs)) delete store.entries[encoded]
      }
      const encoded = encodeKey(kernelIssuer, origin)
      delete store.entries[encoded]
      store.entries[encoded] = Object.freeze({ issuer: domainIssuer, observedAt: now })
      const keys = Object.keys(store.entries)
      for (const stale of keys.slice(0, Math.max(0, keys.length - MAXIMUM_ENTRIES))) {
        delete store.entries[stale]
      }
    })
  }

  /**
   * Forget one entry. When the store cannot be rewritten (no space, lock unavailable), remove the
   * whole file instead: unlinking needs neither, and a lost entry only costs one installation read.
   */
  async delete(kernelIssuer: string, origin: string): Promise<void> {
    try {
      await this.transition((store) => {
        delete store.entries[encodeKey(kernelIssuer, origin)]
      })
    } catch (cause) {
      await rm(this.path, { force: true }).catch(() => {
        throw cause
      })
    }
  }

  async deleteKernel(kernelIssuer: string): Promise<void> {
    await this.transition((store) => {
      for (const encoded of Object.keys(store.entries)) {
        if (decodeKernel(encoded) !== kernelIssuer) continue
        delete store.entries[encoded]
      }
    })
  }

  private async transition(change: (store: domainIssuers.Artifact) => void): Promise<void> {
    await withFileLock(
      `${this.path}.lock`,
      async () => {
        const directory = dirname(this.path)
        await mkdir(directory, { recursive: true, mode: 0o700 })
        await chmod(directory, 0o700)
        const store = await readStore(this.path)
        change(store)
        await atomicWrite(this.path, `${JSON.stringify(store, null, 2)}\n`)
        await chmod(this.path, 0o600)
      },
      this.lock,
    )
  }
}

export const DOMAIN_ISSUER_CACHE = new DomainIssuerCache()

async function readStore(path: string): Promise<domainIssuers.Artifact> {
  try {
    const input = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return emptyStore()
    const value = input as Record<string, unknown>
    if (
      value.version !== VERSION ||
      value.entries === null ||
      typeof value.entries !== 'object' ||
      Array.isArray(value.entries)
    ) {
      return emptyStore()
    }
    return {
      version: VERSION,
      entries: { ...(value.entries as Record<string, domainIssuers.Entry>) },
    }
  } catch {
    return emptyStore()
  }
}

function emptyStore(): domainIssuers.Artifact {
  return { version: VERSION, entries: {} }
}

function validEntry(entry: domainIssuers.Entry, now: number, maximumAgeMs: number): boolean {
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
