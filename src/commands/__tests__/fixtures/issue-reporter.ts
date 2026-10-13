import type { Call } from '@astrale-os/sdk/client'
import type { ClientSessionOptions, SessionAuth } from '@astrale-os/sdk/client/session'

import { credential as credentials } from '@astrale-os/sdk/auth'
import * as clientSession from '@astrale-os/sdk/client/session'
import { mock } from 'bun:test'
import { appendFile } from 'node:fs/promises'

// A fake Admin kernel holding one Issue that alice reported. Like the real Kernel, it bounds what
// a Domain reads for alice by that Domain's own authority, and the Admin Domain holds none over
// Issues: a read the Admin Domain makes for alice sees no Issue, while alice acting for herself
// sees her report through the Issues read rules. Every Client Session the CLI opens is this
// double, so the command, the Admin target resolution, the callable issuer read and the exchange
// are the CLI's own code.
const observed = process.env.ISSUE_REPORTER_OBSERVED
if (observed === undefined) throw new Error('ISSUE_REPORTER_OBSERVED is required')
const adminIssuer = process.env.ISSUE_REPORTER_ADMIN_ISSUER
const issuesIssuer = process.env.ISSUE_REPORTER_ISSUES_ISSUER
if (adminIssuer === undefined || issuesIssuer === undefined)
  throw new Error('ISSUE_REPORTER_ADMIN_ISSUER and ISSUE_REPORTER_ISSUES_ISSUER are required')

const REPORTER = 'alice-identity'
const QUERY = '/:kernel.astrale.ai:function.query'
const WHOAMI = '/:kernel.astrale.ai:class.Identity:whoami'
const ISSUE = 'issues.astrale.ai:class.Issue'
const REPORTED_ISSUE = Object.freeze({
  id: 'issue-1',
  class: ISSUE,
  props: {
    [`${ISSUE}.property.reference`]: 'ASTRALE-1',
    [`${ISSUE}.property.status`]: 'open',
    [`${ISSUE}.property.priority`]: 0,
    [`${ISSUE}.property.archived`]: false,
    'kernel.astrale.ai:class.Named.property.name': 'Reported title',
    'kernel.astrale.ai:class.Descriptable.property.description': 'Details',
    'kernel.astrale.ai:class.Timestamped.property.updatedAt': '2026-10-13T10:00:00.000Z',
  },
})

async function record(event: Record<string, unknown>): Promise<void> {
  await appendFile(observed!, `${JSON.stringify(event)}\n`)
}

/** Who a presented credential acts as: a Domain it was exchanged at, or the identity itself. */
function actingAs(presented: string | undefined): string {
  if (presented === undefined) return 'anonymous'
  const { iss } = credentials.inspect(presented)
  return iss === adminIssuer ? 'admin-domain' : iss === issuesIssuer ? 'issues-domain' : 'self'
}

class FakeAdminKernelSession {
  readonly auth = Object.freeze({
    whoami: async () => {
      await record({ kind: 'whoami', as: await this.present(WHOAMI, {}) })
      return { id: REPORTER }
    },
  })
  readonly schema = Object.freeze({
    inspect: async (origin: string) => {
      await record({ kind: 'inspect', origin })
      return { origin, release: { identity: { issuer: issuesIssuer } } }
    },
  })

  constructor(private readonly options: ClientSessionOptions) {}

  async exchange(issuer: string, options: { readonly ttlSeconds: number }) {
    await record({ kind: 'exchange', issuer })
    const expiresAt = Math.floor(Date.now() / 1_000) + options.ttlSeconds + 120
    return {
      credential: domainCredential(issuer, this.options.kernel, expiresAt),
      expiresAt: expiresAt * 1_000,
    }
  }

  async call(request: Call) {
    const target = (request.target as { readonly raw?: string }).raw ?? String(request.target)
    const as = await this.present(target, request.input)
    if (target === QUERY) {
      const { select } = (request.input as { readonly ast: { readonly select: { kind: string } } })
        .ast
      await record({ kind: 'query', select: select.kind, as })
      const issues = as === 'admin-domain' ? [] : [{ kind: 'value', value: REPORTED_ISSUE }]
      return {
        result:
          select.kind === 'nodes' ? { kind: 'nodes', nodes: issues } : { kind: 'edges', edges: [] },
        page: {},
      }
    }
    await record({ kind: 'call', target, input: request.input, as })
    return { id: REPORTED_ISSUE.id, reference: 'ASTRALE-1', ...(request.input as object) }
  }

  async dispatch(): Promise<never> {
    throw new Error('the fake Admin kernel serves reporter reads and Methods through call')
  }

  close(): void {}

  private async present(target: string, input: unknown): Promise<string> {
    const resolved = await this.options.auth?.resolve(
      { target, input } as Parameters<SessionAuth['resolve']>[0],
      new AbortController().signal,
    )
    return actingAs(resolved?.credential)
  }
}

/** A Domain bearer for the Kernel carrying the caller's identity proof, as an exchange returns. */
function domainCredential(issuer: string, kernel: string, expiresAt: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const proof = `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: kernel,
    sub: REPORTER,
    aud: kernel,
    exp: expiresAt,
    delegation: { v: 1, expr: { kind: 'identity', id: REPORTER } },
  })}.signature`
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: issuer,
    sub: 'domain',
    aud: kernel,
    exp: expiresAt,
    grant: { v: 1, expr: { kind: 'identity', credential: proof } },
  })}.signature`
}

mock.module('@astrale-os/sdk/client/session', () => ({
  ...clientSession,
  ClientSession: FakeAdminKernelSession,
}))

const { buildProgram } = await import('../../../program/index')
const program = await buildProgram()
await program.parseAsync(['node', 'astrale', ...process.argv.slice(2)])
