import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_STATE_PATHS_CAPTURED = defineLaw({
  id: 'CLI-STATE-PATHS-CAPTURED',
  statement:
    'Path construction applies explicit-home then environment then platform-home precedence once; later environment mutation cannot change the returned coordinates.',
  tests: [{ file: '__tests__/paths.test.ts', id: 'TEST-CLI-STATE-PATHS-CAPTURED' }],
})

export const CLI_STATE_ATOMIC_REPLACEMENT = defineLaw({
  id: 'CLI-STATE-ATOMIC-REPLACEMENT',
  statement:
    'A successful replacement publishes one complete mode-0600 file and leaves no temporary file; a failed replacement never publishes partial content.',
  tests: [
    { file: '__tests__/files.test.ts', id: 'TEST-CLI-STATE-ATOMIC-WRITE' },
    { file: '__tests__/files.test.ts', id: 'TEST-CLI-STATE-ATOMIC-WRITE-FAILURE' },
  ],
})

export const CLI_STATE_LOCK_BOUNDED = defineLaw({
  id: 'CLI-STATE-LOCK-BOUNDED',
  statement:
    'Contending transitions serialize, abandoned locks are recoverable, acquisition is bounded, and every acquired lock is released after success or failure.',
  tests: [
    { file: '__tests__/files.test.ts', id: 'TEST-CLI-STATE-LOCK-SERIALIZES' },
    { file: '__tests__/files.test.ts', id: 'TEST-CLI-STATE-LOCK-RECOVERS' },
    { file: '__tests__/files.test.ts', id: 'TEST-CLI-STATE-LOCK-RELEASES-AND-BOUNDS' },
  ],
})

export const CLI_STATE_IDENTITY_READ_SAFE = defineLaw({
  id: 'CLI-STATE-IDENTITY-READ-SAFE',
  statement:
    'Missing and V1 identity files decode without a write; unversioned, malformed, or unsupported-version files fail without replacement.',
  tests: [
    { file: '__tests__/identities.test.ts', id: 'TEST-CLI-STATE-IDENTITY-READ-SAFE' },
    { file: '__tests__/identities.test.ts', id: 'TEST-CLI-STATE-IDENTITY-FAILS-CLOSED' },
  ],
})

export const CLI_STATE_IDENTITY_TRANSITIONS = defineLaw({
  id: 'CLI-STATE-IDENTITY-TRANSITIONS',
  statement:
    'Unversioned identity state is refused before a transition or any file replacement; concurrent V1 mutations reread and retain every committed transition.',
  tests: [
    { file: '__tests__/identities.test.ts', id: 'TEST-CLI-STATE-IDENTITY-UNVERSIONED-REFUSED' },
    { file: '__tests__/identities.test.ts', id: 'TEST-CLI-STATE-IDENTITY-CONCURRENT' },
  ],
})

export const CLI_STATE_EXCHANGE_CACHE = defineLaw({
  id: 'CLI-STATE-EXCHANGE-CACHE',
  statement:
    'The durable exchange Artifact partitions Domain credentials by exact Kernel issuer, Domain issuer, source issuer, and source subject; exact lookup and refresh both require the sole nested Kernel proof subject to equal the retained registered User, matching token claims, and sufficient expiry. Refresh runs under process and file-lock singleflight, and publication remains owner-private and atomic.',
  tests: [
    {
      file: '__tests__/exchange-credentials.test.ts',
      id: 'TEST-CLI-EXCHANGE-CACHE-EXACT-KEY-AND-PRIVATE-MODE',
    },
    {
      file: '__tests__/exchange-credentials.test.ts',
      id: 'TEST-CLI-EXCHANGE-CACHE-EXACT-LIVE-LOOKUP',
    },
    {
      file: '__tests__/exchange-credentials.test.ts',
      id: 'TEST-CLI-EXCHANGE-CACHE-READ-DOES-NOT-WAIT-FOR-REFRESH',
    },
    {
      file: '__tests__/exchange-credentials.test.ts',
      id: 'TEST-CLI-EXCHANGE-CACHE-SINGLEFLIGHT-CROSS-INSTANCE',
    },
    {
      file: '__tests__/exchange-credentials.test.ts',
      id: 'TEST-CLI-EXCHANGE-CACHE-REJECTS-STALE-OR-MISBOUND',
    },
    {
      file: '__tests__/exchange-credentials.test.ts',
      id: 'TEST-CLI-EXCHANGE-CACHE-LIFECYCLE-INVALIDATION',
    },
  ],
})

export const CLI_STATE_INSTALLATION_CACHE = defineLaw({
  id: 'CLI-STATE-INSTALLATION-CACHE',
  statement:
    'The durable installation Artifact maps an exact source Kernel issuer and Domain origin to what the CLI remembers of that installation: the Domain issuer its pin named when last read, or null for a Kernel-hosted Domain. A record is a hint, never authority: a consented reinstall can move the issuer within one installation, so only a fact whose staleness fails closed at token exchange or Kernel admission is recorded, and its reader forgets it after a failure that relied on it; a fact an upgrade changes without failing closed (revision, bindings, readiness) is never served from it. It carries no credential. Records older than the maximum age, from the future, or without a canonical issuer are misses; publication is owner-private and atomic, bounded in size, and removed with the Kernel bookmark. A record is trusted only while it can still be forgotten: without a writable directory every record is a miss, and a deletion that cannot rewrite the store removes the whole file.',
  tests: [
    { file: '__tests__/installations.test.ts', id: 'TEST-CLI-INSTALLATION-CACHE-PARTITION' },
    { file: '__tests__/installations.test.ts', id: 'TEST-CLI-INSTALLATION-CACHE-BOUNDED' },
    { file: '__tests__/installations.test.ts', id: 'TEST-CLI-INSTALLATION-CACHE-EVICTABLE' },
  ],
})
