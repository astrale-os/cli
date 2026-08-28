import { credential, grant } from '@astrale-os/sdk/auth'
import { chmod, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { credentialLifetimeCovers } from '../lib/credential-lifetime'
import { atomicWrite, withFileLock } from './files'
import { EXCHANGE_CREDENTIALS_PATH } from './paths'

const VERSION = 2
const MINIMUM_REMAINING_SECONDS = 30

export namespace exchange {
  export interface Artifact {
    readonly version: 2
    readonly entries: Record<string, Entry>
  }

  export interface Key {
    readonly kernelIssuer: string
    readonly domainIssuer: string
    readonly sourceIssuer: string
    readonly sourceSubject: string
  }

  export interface Entry {
    readonly credential: string
    readonly expiresAt: number
    readonly user: string
    readonly sourceIssuer: string
    readonly sourceSubject: string
  }
}

export class ExchangeCredentialCache {
  private readonly refreshing = new Map<string, Promise<string>>()

  constructor(private readonly path = EXCHANGE_CREDENTIALS_PATH) {}

  async get(
    key: exchange.Key,
    minimumRemainingSeconds: number,
    now = () => Math.floor(Date.now() / 1_000),
  ): Promise<string | undefined> {
    requireMinimumRemainingSeconds(minimumRemainingSeconds)
    const encoded = encodeKey(key)
    const store = await readStore(this.path)
    const observedAt = now()
    const cached = store.entries[encoded]
    return cached !== undefined && validEntry(key, cached, observedAt, minimumRemainingSeconds)
      ? cached.credential
      : undefined
  }

  getOrRefresh(
    key: exchange.Key,
    minimumRemainingSeconds: number,
    refresh: () => Promise<exchange.Entry>,
    now = () => Math.floor(Date.now() / 1_000),
  ): Promise<string> {
    requireMinimumRemainingSeconds(minimumRemainingSeconds)
    const encoded = encodeKey(key)
    const pendingKey = `${encoded}\0${minimumRemainingSeconds}`
    const current = this.refreshing.get(pendingKey)
    if (current !== undefined) return current
    const pending = this.getOrRefreshOnce(
      key,
      encoded,
      minimumRemainingSeconds,
      refresh,
      now,
    ).finally(() => {
      this.refreshing.delete(pendingKey)
    })
    this.refreshing.set(pendingKey, pending)
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
    minimumRemainingSeconds: number,
    refresh: () => Promise<exchange.Entry>,
    now: () => number,
  ): Promise<string> {
    return withFileLock(`${this.path}.lock`, async () => {
      await ensurePrivateDirectory(this.path)
      const store = await readStore(this.path)
      const changed = scrub(store, now())
      const cached = store.entries[encoded]
      if (cached !== undefined && validEntry(key, cached, now(), minimumRemainingSeconds)) {
        if (changed) await writeStore(this.path, store)
        return cached.credential
      }

      const next = await refresh()
      if (!validEntry(key, next, now(), minimumRemainingSeconds)) {
        throw new Error(
          'Token exchange returned a credential inconsistent with its cache key or required lifetime.',
        )
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

function requireMinimumRemainingSeconds(input: number): void {
  if (!Number.isSafeInteger(input) || input < 1) {
    throw new TypeError('Exchange credential minimum lifetime must be a positive safe integer.')
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
    Reflect.ownKeys(entry).length !== 5 ||
    typeof entry.credential !== 'string' ||
    entry.credential.length === 0 ||
    !Number.isSafeInteger(entry.expiresAt) ||
    entry.expiresAt - now < minimumRemaining ||
    typeof entry.user !== 'string' ||
    entry.user.length === 0 ||
    entry.sourceIssuer !== key.sourceIssuer ||
    entry.sourceSubject !== key.sourceSubject
  ) {
    return false
  }
  try {
    const inspected = credential.inspect(entry.credential)
    const carried = grant.acceptUnresolved(inspected.claims.grant).expr
    if (
      carried.kind !== 'identity' ||
      !('credential' in carried) ||
      typeof carried.credential !== 'string'
    ) {
      return false
    }
    const proof = credential.inspect(carried.credential)
    const issued = proof.claims.delegation
    if (
      issued === null ||
      typeof issued !== 'object' ||
      Array.isArray(issued) ||
      Reflect.ownKeys(issued).length !== 2 ||
      !Object.hasOwn(issued, 'v') ||
      !Object.hasOwn(issued, 'expr') ||
      Reflect.get(issued, 'v') !== 1
    ) {
      return false
    }
    grant.accept({ expr: Reflect.get(issued, 'expr') })
    return (
      inspected.iss === key.domainIssuer &&
      inspected.aud === key.kernelIssuer &&
      inspected.claims.exp === entry.expiresAt &&
      !Object.hasOwn(inspected.claims, 'delegation') &&
      proof.iss === key.kernelIssuer &&
      proof.sub === entry.user &&
      proof.aud === key.kernelIssuer &&
      typeof proof.claims.exp === 'number' &&
      Number.isSafeInteger(proof.claims.exp) &&
      credentialLifetimeCovers(proof.claims.exp, minimumRemaining, now)
    )
  } catch {
    return false
  }
}

function encodeKey(key: exchange.Key): string {
  return JSON.stringify([key.kernelIssuer, key.domainIssuer, key.sourceIssuer, key.sourceSubject])
}

function decodeKey(input: string): exchange.Key | undefined {
  try {
    const value = JSON.parse(input) as unknown
    if (
      !Array.isArray(value) ||
      value.length !== 4 ||
      value.some((part) => typeof part !== 'string' || part.length === 0)
    ) {
      return undefined
    }
    return {
      kernelIssuer: value[0]!,
      domainIssuer: value[1]!,
      sourceIssuer: value[2]!,
      sourceSubject: value[3]!,
    }
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
