import type { Fetch } from '@astrale-os/sdk/client'
import type { SessionAuth } from '@astrale-os/sdk/client/session'

import { issuer } from '@astrale-os/sdk/auth'
import { credential as inspect } from '@astrale-os/sdk/auth'
import { Path } from '@astrale-os/sdk/graph/path'

import type { AstraleConfig } from '../../../lib/config'

import { createIdentity, setRegistration, upsertIdpIdentity } from '../../../identity/registry'
import { saveIdpSession } from '../../../lib/idp'
import { ExchangeCredentialCache } from '../../../state/exchange-credentials'
import { resolveCredential } from '../../auth'
import { createCliCredential } from '../../credential'

const KERNEL = issuer.accept('https://kernel.example')
const DOMAIN = issuer.accept('https://admin.example')
const SOURCE_ISSUER = 'https://workos.example'
const now = Math.floor(Date.now() / 1_000)
const call = Object.freeze({
  target: Path.parse('/:example.dev:function.call').raw,
  input: {},
}) satisfies Parameters<SessionAuth['resolve']>[0]
const config: AstraleConfig = {
  issuer: 'https://cli.example',
  admin: { name: 'admin', url: KERNEL, kernelIssuer: KERNEL },
  telemetry: { enabled: false, analyzerEnabled: false },
  browser: {},
}

/** Carol's cached session names another subject: its cache entry belongs to someone else. */
const identities = [
  {
    name: 'alice',
    subject: 'source-alice',
    claimed: 'source-alice',
    user: 'kernel-alice',
    use: false,
  },
  { name: 'bob', subject: 'source-bob', claimed: 'source-bob', user: 'kernel-bob', use: true },
  {
    name: 'carol',
    subject: 'source-carol',
    claimed: 'source-dave',
    user: 'kernel-dave',
    use: false,
  },
] as const
const cache = new ExchangeCredentialCache()
const expected = new Map<string, string>()

for (const identity of identities) {
  await upsertIdpIdentity(identity.name, {
    subject: identity.subject,
    idp: 'workos',
    issuer: SOURCE_ISSUER,
    use: identity.use,
  })
  await saveIdpSession({
    identity: identity.name,
    idp: 'workos',
    issuer: SOURCE_ISSUER,
    subject: identity.subject,
    access_token: 'expired-source-token-must-not-be-resolved',
    expires_at: '2026-01-01T00:00:00.000Z',
    claims: { iss: SOURCE_ISSUER, sub: identity.claimed },
    updatedAt: new Date().toISOString(),
  })
  const key = {
    kernelIssuer: KERNEL,
    domainIssuer: DOMAIN,
    sourceIssuer: SOURCE_ISSUER,
    sourceSubject: identity.claimed,
  }
  const credential = token(identity.user, now + 300)
  expected.set(identity.name, credential)
  await cache.getOrRefresh(
    key,
    65,
    async () => ({
      credential,
      expiresAt: now + 300,
      user: identity.user,
      sourceIssuer: SOURCE_ISSUER,
      sourceSubject: identity.claimed,
    }),
    () => now,
  )
}

let fetches = 0
const fetch: Fetch = async () => {
  fetches += 1
  throw new Error('a live cache hit must not use network I/O')
}
const explicit = createCliCredential(
  { url: KERNEL, kernelIssuer: KERNEL, domainIssuer: DOMAIN },
  { as: 'alice' },
  config,
  fetch,
)
const active = createCliCredential(
  { url: KERNEL, kernelIssuer: KERNEL, domainIssuer: DOMAIN },
  {},
  config,
  fetch,
)
const mismatched = createCliCredential(
  { url: KERNEL, kernelIssuer: KERNEL, domainIssuer: DOMAIN },
  { as: 'carol' },
  config,
  fetch,
)
if (explicit === undefined || active === undefined || mismatched === undefined)
  throw new Error('expected authenticated sources')

const signal = new AbortController().signal
const [alice, bob] = await Promise.all([
  explicit.resolve(call, signal),
  active.resolve(call, signal),
])
const carol = await Promise.resolve(mismatched.resolve(call, signal)).then(
  (resolved) => resolved.credential,
  () => undefined,
)

// Key identities sign the Kernel registration's (iss, sub); an imported system root, the audience.
await createIdentity('registered')
await setRegistration('registered', KERNEL, {
  iss: `${KERNEL}/iss/registered`,
  sub: 'registered-node',
  registeredAt: new Date().toISOString(),
})
await createIdentity('root', { subject: 'system' })
const claims = async (as: string) => {
  const { iss, sub } = inspect.inspect(await resolveCredential({ as }, config, KERNEL, KERNEL))
  return { iss, sub }
}

console.log(
  JSON.stringify({
    explicit: alice.credential === expected.get('alice'),
    active: bob.credential === expected.get('bob'),
    foreign: carol === expected.get('carol'),
    fetches,
    registered: await claims('registered'),
    root: await claims('root'),
  }),
)

function token(user: string, expiresAt: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const proof = `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: KERNEL,
    sub: user,
    aud: KERNEL,
    exp: expiresAt,
    delegation: { v: 1, expr: { kind: 'identity', id: user } },
  })}.signature`
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: DOMAIN,
    sub: 'admin-domain',
    aud: KERNEL,
    exp: expiresAt,
    grant: { v: 1, expr: { kind: 'identity', credential: proof } },
  })}.signature`
}
