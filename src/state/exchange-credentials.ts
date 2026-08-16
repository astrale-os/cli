import { credential } from '@astrale-os/sdk/auth'
import { chmod, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { atomicWrite, withFileLock } from './files'
import { EXCHANGE_CREDENTIALS_PATH } from './paths'

const VERSION = 1
const MINIMUM_REMAINING_SECONDS = 30

export namespace exchange {
  export interface Artifact {
    readonly version: 1
    readonly entries: Record<string, Entry>
  }

  export interface Key {
    readonly kernelIssuer: string
    readonly domainIssuer: string
    readonly user: string
  }

  export interface Entry {
    readonly credential: string
    readonly expiresAt: number
  }
}

export class ExchangeCredentialCache {
  private readonly refreshing = new Map<string, Promise<string>>()

  constructor(private readonly path = EXCHANGE_CREDENTIALS_PATH) {}

  getOrRefresh(
    key: exchange.Key,
    refresh: () => Promise<exchange.Entry>,
    now = () => Math.floor(Date.now() / 1_000),
  ): Promise<string> {
    const encoded = encodeKey(key)
    const current = this.refreshing.get(encoded)
    if (current !== undefined) return current
    const pending = this.getOrRefreshOnce(key, encoded, refresh, now).finally(() => {
      this.refreshing.delete(encoded)
    })
    this.refreshing.set(encoded, pending)
    return pending
  }

  async deleteKernel(kernelIssuer: string): Promise<void> {
    await this.transition((store) => {
      for (const encoded of Object.keys(store.entries)) {
        const key = decodeKey(encoded)
        if (key === undefined || key.kernelIssuer === kernelIssuer) delete store.entries[encoded]
      }
    })
  }

  async clear(): Promise<void> {
    await this.transition((store) => {
      for (const encoded of Object.keys(store.entries)) delete store.entries[encoded]
    })
  }

  private async getOrRefreshOnce(
    key: exchange.Key,
    encoded: string,
    refresh: () => Promise<exchange.Entry>,
    now: () => number,
  ): Promise<string> {
    return withFileLock(`${this.path}.lock`, async () => {
      await ensurePrivateDirectory(this.path)
      const store = await readStore(this.path)
      const changed = scrub(store, now())
      const cached = store.entries[encoded]
      if (cached !== undefined && validEntry(key, cached, now())) {
        if (changed) await writeStore(this.path, store)
        return cached.credential
      }

      const next = await refresh()
      if (!validEntry(key, next, now(), 1)) {
        throw new Error('Token exchange returned a credential inconsistent with its cache key.')
      }
      store.entries[encoded] = Object.freeze({ ...next })
      await writeStore(this.path, store)
      return next.credential
    })
  }

  private async transition(change: (store: exchange.Artifact) => void): Promise<void> {
    await withFileLock(`${this.path}.lock`, async () => {
      await ensurePrivateDirectory(this.path)
      const store = await readStore(this.path)
      change(store)
      await writeStore(this.path, store)
    })
  }
}

async function readStore(path: string): Promise<exchange.Artifact> {
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
    return { version: VERSION, entries: { ...(value.entries as Record<string, exchange.Entry>) } }
  } catch {
    return emptyStore()
  }
}

function emptyStore(): exchange.Artifact {
  return { version: VERSION, entries: {} }
}

async function writeStore(path: string, store: exchange.Artifact): Promise<void> {
  await atomicWrite(path, `${JSON.stringify(store, null, 2)}\n`)
  await chmod(path, 0o600)
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
}

function validEntry(
  key: exchange.Key,
  entry: exchange.Entry,
  now: number,
  minimumRemaining = MINIMUM_REMAINING_SECONDS,
): boolean {
  if (
    entry === null ||
    typeof entry !== 'object' ||
    Reflect.ownKeys(entry).length !== 2 ||
    typeof entry.credential !== 'string' ||
    entry.credential.length === 0 ||
    !Number.isSafeInteger(entry.expiresAt) ||
    entry.expiresAt - now < minimumRemaining
  ) {
    return false
  }
  try {
    const inspected = credential.inspect(entry.credential)
    return (
      inspected.iss === key.domainIssuer &&
      inspected.aud === key.kernelIssuer &&
      inspected.claims.exp === entry.expiresAt
    )
  } catch {
    return false
  }
}

function encodeKey(key: exchange.Key): string {
  return JSON.stringify([key.kernelIssuer, key.domainIssuer, key.user])
}

function decodeKey(input: string): exchange.Key | undefined {
  try {
    const value = JSON.parse(input) as unknown
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value.some((part) => typeof part !== 'string' || part.length === 0)
    ) {
      return undefined
    }
    return { kernelIssuer: value[0]!, domainIssuer: value[1]!, user: value[2]! }
  } catch {
    return undefined
  }
}

function scrub(store: Pick<exchange.Artifact, 'entries'>, now: number): boolean {
  let changed = false
  for (const [encoded, entry] of Object.entries(store.entries)) {
    const key = decodeKey(encoded)
    if (key === undefined || !validEntry(key, entry, now, 1)) {
      delete store.entries[encoded]
      changed = true
    }
  }
  return changed
}
