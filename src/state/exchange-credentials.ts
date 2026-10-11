import { credential, grant } from '@astrale-os/sdk/auth'

import { credentialLifetimeCovers } from '../lib/credential-lifetime'
import { exchangeCallerProof } from '../lib/exchange-grant'
import { readPrivateStore, updatePrivateStore } from './files'
import { EXCHANGE_CREDENTIALS_PATH } from './paths'

const VERSION = 2
const MINIMUM_REMAINING_SECONDS = 30

/** One persisted Domain credential: exchanged at `domainIssuer` for a source identity on a Kernel. */
interface ExchangeKey {
  readonly kernelIssuer: string
  readonly domainIssuer: string
  readonly sourceIssuer: string
  readonly sourceSubject: string
}

interface ExchangeEntry {
  readonly credential: string
  readonly expiresAt: number
  readonly user: string
  readonly sourceIssuer: string
  readonly sourceSubject: string
}

export class ExchangeCredentialCache {
  private readonly refreshing = new Map<string, Promise<string>>()

  constructor(private readonly path = EXCHANGE_CREDENTIALS_PATH) {}

  async get(
    key: ExchangeKey,
    minimumRemainingSeconds: number,
    now = () => Math.floor(Date.now() / 1_000),
  ): Promise<string | undefined> {
    requireMinimumRemainingSeconds(minimumRemainingSeconds)
    const cached = (await readPrivateStore<ExchangeEntry>(this.path, VERSION))[encodeKey(key)]
    return cached !== undefined && validEntry(key, cached, now(), minimumRemainingSeconds)
      ? cached.credential
      : undefined
  }

  getOrRefresh(
    key: ExchangeKey,
    minimumRemainingSeconds: number,
    refresh: () => Promise<ExchangeEntry>,
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
    await this.transition((entries) => {
      for (const encoded of Object.keys(entries)) {
        const key = decodeKey(encoded)
        if (key === undefined || key.kernelIssuer === kernelIssuer) delete entries[encoded]
      }
    })
  }

  async clear(): Promise<void> {
    await this.transition((entries) => {
      for (const encoded of Object.keys(entries)) delete entries[encoded]
    })
  }

  private getOrRefreshOnce(
    key: ExchangeKey,
    encoded: string,
    minimumRemainingSeconds: number,
    refresh: () => Promise<ExchangeEntry>,
    now: () => number,
  ): Promise<string> {
    return updatePrivateStore<ExchangeEntry, string>(this.path, VERSION, async (entries) => {
      const changed = scrub(entries, now())
      const cached = entries[encoded]
      if (cached !== undefined && validEntry(key, cached, now(), minimumRemainingSeconds)) {
        return { value: cached.credential, changed }
      }
      const next = await refresh()
      if (!validEntry(key, next, now(), minimumRemainingSeconds)) {
        throw new Error(
          'Token exchange returned a credential inconsistent with its cache key or required lifetime.',
        )
      }
      entries[encoded] = Object.freeze({ ...next })
      return { value: next.credential, changed: true }
    })
  }

  private async transition(
    change: (entries: Record<string, ExchangeEntry>) => void,
  ): Promise<void> {
    await updatePrivateStore<ExchangeEntry, void>(this.path, VERSION, async (entries) => {
      change(entries)
      return { value: undefined, changed: true }
    })
  }
}

function requireMinimumRemainingSeconds(input: number): void {
  if (!Number.isSafeInteger(input) || input < 1) {
    throw new TypeError('Exchange credential minimum lifetime must be a positive safe integer.')
  }
}

function validEntry(
  key: ExchangeKey,
  entry: ExchangeEntry,
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
    const carried = exchangeCallerProof(grant.acceptUnresolved(inspected.claims.grant).expr)
    if (carried === undefined) return false
    const proof = credential.inspect(carried)
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

function encodeKey(key: ExchangeKey): string {
  return JSON.stringify([key.kernelIssuer, key.domainIssuer, key.sourceIssuer, key.sourceSubject])
}

function decodeKey(input: string): ExchangeKey | undefined {
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

function scrub(entries: Record<string, ExchangeEntry>, now: number): boolean {
  let changed = false
  for (const [encoded, entry] of Object.entries(entries)) {
    const key = decodeKey(encoded)
    if (key === undefined || !validEntry(key, entry, now, 1)) {
      delete entries[encoded]
      changed = true
    }
  }
  return changed
}
