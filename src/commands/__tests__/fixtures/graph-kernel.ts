import type { Call } from '@astrale-os/sdk/client'
import type { ClientSessionOptions, SessionAuth } from '@astrale-os/sdk/client/session'

import { credential as credentials } from '@astrale-os/sdk/auth'
import * as clientSession from '@astrale-os/sdk/client/session'
import { mock } from 'bun:test'
import { appendFile } from 'node:fs/promises'

// A fake Kernel holding one Issue that alice may read. Like the real Kernel, it bounds what a
// Domain reads for alice by that Domain's own authority, and the target's Domain holds none over
// Issues: a read through a Domain exchange sees no Issue, while alice acting for herself sees it
// through the Issues read rules. Every Client Session the CLI opens is this double, so the
// command, the target resolution and any exchange are the CLI's own code.
const observed = process.env.GRAPH_KERNEL_OBSERVED
if (observed === undefined) throw new Error('GRAPH_KERNEL_OBSERVED is required')
const domainIssuers = new Set<string>(JSON.parse(process.env.GRAPH_KERNEL_DOMAIN_ISSUERS ?? '[]'))

const ALICE = 'alice-identity'
const QUERY = '/:kernel.astrale.ai:function.query'
const MUTATE = '/:kernel.astrale.ai:function.mutate'
const WHOAMI = '/:kernel.astrale.ai:class.Identity:whoami'
const ISSUE = Object.freeze({
  id: 'issue-1',
  class: 'issues.astrale.ai:class.Issue',
  props: { 'kernel.astrale.ai:class.Named.property.name': 'Reported title' },
})

async function record(event: Record<string, unknown>): Promise<void> {
  await appendFile(observed!, `${JSON.stringify(event)}\n`)
}

/** Who a presented credential acts as: a Domain it was exchanged at, or the identity itself. */
function actingAs(presented: string | undefined): string {
  if (presented === undefined) return 'anonymous'
  const { iss } = credentials.inspect(presented)
  return iss !== undefined && domainIssuers.has(iss) ? 'domain' : 'self'
}

class FakeKernelSession {
  readonly auth = Object.freeze({
    whoami: async () => {
      await record({ kind: 'whoami', as: await this.present(WHOAMI, {}) })
      return { id: ALICE }
    },
  })
  readonly schema = Object.freeze({
    inspect: async (origin: string) => {
      await record({ kind: 'inspect', origin })
      throw new Error('a graph command reads no installed Domain')
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
    await record({ kind: 'call', target, as })
    if (target === QUERY) {
      const nodes = as === 'self' ? [ISSUE] : []
      return {
        result: {
          kind: 'graph',
          graph: { nodes, edges: [] },
          selection: { kind: 'node', ids: nodes.map(({ id }) => id) },
        },
        page: {},
      }
    }
    if (target === MUTATE) return { createdNodes: as === 'self' ? { issue: 'issue-2' } : {} }
    throw new Error(`the fake Kernel serves no ${target}`)
  }

  async dispatch(): Promise<never> {
    throw new Error('the fake Kernel serves graph commands through call')
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
    sub: ALICE,
    aud: kernel,
    exp: expiresAt,
    delegation: { v: 1, expr: { kind: 'identity', id: ALICE } },
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
  ClientSession: FakeKernelSession,
}))

const { buildProgram } = await import('../../../program/index')
const program = await buildProgram()
await program.parseAsync(['node', 'astrale', ...process.argv.slice(2)])
