import type { Fetch } from '@astrale-os/sdk/client'

import { credential, issuer } from '@astrale-os/sdk/auth'
import { Path } from '@astrale-os/sdk/graph/path'
import { mock } from 'bun:test'
import assert from 'node:assert/strict'

import type { CredentialIntent } from '../../../connection/credential'
import type { ConnectionContext } from '../../../connection/session'
import type { ConnectionOptions } from '../../../connection/target'
import type { AstraleConfig } from '../../../lib/config'

import { createCliCredential } from '../../../connection/credential'
import { withResolvedClientSession } from '../../../connection/session'
import { resolveConnectionTarget } from '../../../connection/target'
import {
  createIdentity,
  setDefault,
  setRegistration,
  upsertIdpIdentity,
} from '../../../identity/registry'
import { saveIdpSession } from '../../../lib/idp'
import { ExchangeCredentialCache } from '../../../state/exchange-credentials'

const KERNEL = issuer.accept('https://kernel.example/api')
const SHELL = issuer.accept('https://shell.example')
const now = Math.floor(Date.now() / 1_000)
const config: AstraleConfig = {
  issuer: 'https://cli.example',
  admin: { name: 'admin', url: KERNEL, kernelIssuer: KERNEL },
  telemetry: { enabled: false, analyzerEnabled: false },
  browser: {},
}
const actors = [
  { name: 'operator', issuer: KERNEL, key: true, native: true },
  { name: 'employee', issuer: `${KERNEL}/self/employee`, key: true },
  { name: 'application', issuer: 'https://application.example', key: true },
  { name: 'registered', issuer: `${KERNEL}/self/registered`, key: true, registered: true },
  { name: 'human', issuer: 'https://idp.example', key: false },
  { name: 'kernel-idp', issuer: KERNEL, key: false },
] as const
const cache = new ExchangeCredentialCache()
for (const actor of actors) {
  if (actor.key) {
    await createIdentity(actor.name, { issuer: 'registered' in actor ? KERNEL : actor.issuer })
    if ('registered' in actor) {
      await setRegistration(actor.name, KERNEL, {
        iss: actor.issuer,
        sub: actor.name,
        registeredAt: new Date().toISOString(),
      })
    }
  } else {
    await upsertIdpIdentity(actor.name, { subject: actor.name, issuer: actor.issuer, idp: 'test' })
    // A warm exchange must work without refreshing this expired upstream credential.
    await saveIdpSession({
      identity: actor.name,
      idp: 'test',
      issuer: actor.issuer,
      subject: actor.name,
      access_token: 'expired-source-must-not-be-resolved',
      expires_at: '2026-01-01T00:00:00.000Z',
      claims: { iss: actor.issuer, sub: actor.name },
      updatedAt: new Date().toISOString(),
    })
  }
  await cache.getOrRefresh(
    {
      kernelIssuer: KERNEL,
      domainIssuer: SHELL,
      sourceIssuer: actor.issuer,
      sourceSubject: actor.name,
    },
    65,
    async () => ({
      credential: exchanged(actor.name),
      expiresAt: now + 600,
      user: actor.name,
      sourceIssuer: actor.issuer,
      sourceSubject: actor.name,
    }),
  )
}

let networkRequests = 0
let observations = 0
let expectedIssuer: string | undefined
let expectedSubject: string | undefined
let bookmarkIdentity: string | undefined
const noNetwork: Fetch = async () => {
  networkRequests += 1
  throw new Error('Credential selection must not perform network I/O')
}

mock.module('../../../connection', () => ({
  expandSelfInPath: async (path: string) => ({ path }),
  withSelfHint: async (action: () => Promise<unknown>) => action(),
  async runKernelCommand(run: {
    opts: ConnectionOptions
    credential?: CredentialIntent
    fn(context: ConnectionContext): Promise<unknown>
  }) {
    const target = await resolveConnectionTarget(run.opts, config, {
      instances: {
        active: 'staging',
        instances: {
          staging: {
            url: KERNEL,
            issuer: KERNEL,
            domainIssuer: SHELL,
            defaultIdentity: bookmarkIdentity,
          },
        },
      },
    })
    await withResolvedClientSession(
      target,
      run.opts,
      config,
      run.fn,
      (resolved, timeout, options, configuration, intent) => {
        const auth = createCliCredential(
          resolved,
          options,
          configuration,
          noNetwork,
          timeout,
          intent,
        )
        const observe = async (operation: 'query' | 'mutate') => {
          const value = await auth?.resolve(
            {
              target: Path.parse(`/:kernel.astrale.ai:function.${operation}`).raw,
              input: {},
            },
            new AbortController().signal,
          )
          observations += 1
          if (expectedIssuer === undefined) {
            assert.equal(value?.credential, undefined)
          } else {
            assert(value?.credential)
            const inspected = credential.inspect(value.credential)
            assert.equal(inspected.iss, expectedIssuer)
            assert.equal(inspected.sub, expectedSubject)
            assert.equal(inspected.claims.aud, KERNEL)
            // Native/local signing keeps its own grant; an explicit token is not exchanged again.
            if (expectedIssuer === KERNEL)
              assert.deepEqual(inspected.claims.grant, {
                v: 1,
                expr: { kind: 'identity', id: expectedSubject },
              })
          }
        }
        const context = {
          target: resolved,
          graph: {
            async getOrThrow() {
              await observe('query')
              return { id: 'record', class: 'notes.example:class.Note', props: {} }
            },
            async query() {
              await observe('query')
              return { result: { kind: 'graph', graph: { nodes: [], edges: [] } }, page: {} }
            },
            async mutate() {
              await observe('mutate')
              return { createdNodes: {} }
            },
          },
        } as unknown as ConnectionContext
        return { context, close() {} }
      },
      run.credential,
    )
  },
}))

const { getCommand } = await import('../../get')
const { queryCommand } = await import('../../query')
const { mutateCommand } = await import('../../mutate')
const commands = [
  (options: ConnectionOptions) => getCommand('@record', { ...options, json: true }),
  (options: ConnectionOptions) => queryCommand(['@record'], { ...options, json: true }),
  (options: ConnectionOptions) =>
    mutateCommand({
      ...options,
      json: true,
      data: JSON.stringify({
        preconditions: [],
        operations: [
          { op: 'node.create', as: 'record', class: 'notes.example:class.Note', props: {} },
        ],
      }),
    }),
]
for (const command of commands) {
  bookmarkIdentity = undefined
  for (const actor of actors) {
    expectedIssuer = 'native' in actor ? KERNEL : SHELL
    expectedSubject = 'native' in actor ? actor.name : 'shell.example'
    await command({ instance: 'staging', as: actor.name })
    if (actor.key) {
      expectedIssuer = actor.issuer
      expectedSubject = actor.name
      await command({ url: KERNEL, as: actor.name })
    }
  }
  await setDefault('operator')
  expectedIssuer = KERNEL
  expectedSubject = 'operator'
  await command({ instance: 'staging' })
  bookmarkIdentity = 'human'
  expectedIssuer = SHELL
  expectedSubject = 'shell.example'
  await command({ instance: 'staging' })
  expectedIssuer = KERNEL
  expectedSubject = 'operator'
  await command({ instance: 'staging', as: 'operator' })

  // Explicit modes must not even resolve an unavailable bookmark identity.
  bookmarkIdentity = 'missing'
  for (const target of [{ instance: 'staging' }, { url: KERNEL }]) {
    expectedIssuer = SHELL
    expectedSubject = 'shell.example'
    await command({ ...target, creds: exchanged('explicit') })
    expectedIssuer = undefined
    expectedSubject = undefined
    await command({ ...target, anonymous: true })
  }
}
assert.equal(networkRequests, 0)
console.log(JSON.stringify({ observations, networkRequests }))

function exchanged(user: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'ES256', typ: 'JWT' })
  const proof = `${header}.${encode({
    iss: KERNEL,
    sub: user,
    aud: KERNEL,
    exp: now + 600,
    delegation: { v: 1, expr: { kind: 'identity', id: user } },
  })}.signature`
  return `${header}.${encode({
    iss: SHELL,
    sub: 'shell.example',
    aud: KERNEL,
    exp: now + 600,
    grant: { v: 1, expr: { kind: 'identity', credential: proof } },
  })}.signature`
}
