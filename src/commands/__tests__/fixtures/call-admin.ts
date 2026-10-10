import type { Call } from '@astrale-os/sdk/client'
import type { ClientSessionOptions, SessionAuth } from '@astrale-os/sdk/client/session'

import { credential as credentials } from '@astrale-os/sdk/auth'
import * as clientSession from '@astrale-os/sdk/client/session'
import { Path } from '@astrale-os/sdk/graph/path'
import { mock } from 'bun:test'
import { appendFile } from 'node:fs/promises'

// A fake Admin kernel: every Client Session the CLI opens is this double, so the command, the
// Admin target resolution, the callable issuer read and the exchange are the CLI's own code.
// The Admin kernel's installation names SERVICES_ISSUER for services.astrale.ai, and a call
// returns its input's `name`, as Services' setSecret answers.
const observed = process.env.CALL_ADMIN_OBSERVED
if (observed === undefined) throw new Error('CALL_ADMIN_OBSERVED is required')
const servicesIssuer = process.env.CALL_ADMIN_SERVICES_ISSUER ?? 'https://services.admin.test'

async function record(event: Record<string, unknown>): Promise<void> {
  await appendFile(observed!, `${JSON.stringify(event)}\n`)
}

class FakeAdminKernelSession {
  readonly auth = Object.freeze({
    whoami: async () => {
      const resolved = await this.options.auth?.resolve(
        { target: Path.parse('/:kernel.astrale.ai:class.Identity:whoami').raw, input: {} },
        new AbortController().signal,
      )
      const presented = credentials.inspect(resolved!.credential!)
      await record({
        kind: 'confirm',
        kernel: this.options.kernel,
        credentialIssuer: presented.iss,
      })
      return { id: 'admin-user' }
    },
  })
  readonly schema = Object.freeze({
    inspect: async (origin: string) => {
      await record({ kind: 'inspect', kernel: this.options.kernel, origin })
      return { origin, release: { identity: { issuer: servicesIssuer } } }
    },
  })

  constructor(private readonly options: ClientSessionOptions) {}

  async exchange(issuer: string, options: { readonly ttlSeconds: number }) {
    await record({ kind: 'exchange', kernel: this.options.kernel, issuer })
    const expiresAt = Math.floor(Date.now() / 1_000) + options.ttlSeconds + 120
    return {
      credential: domainCredential(issuer, this.options.kernel, expiresAt),
      expiresAt: expiresAt * 1_000,
    }
  }

  async dispatch(call: Call) {
    const target = (call.target as { readonly raw?: string }).raw ?? String(call.target)
    const resolved = await this.options.auth?.resolve(
      { target, input: call.input } as Parameters<SessionAuth['resolve']>[0],
      new AbortController().signal,
    )
    const presented =
      resolved?.credential === undefined ? undefined : credentials.inspect(resolved.credential)
    await record({
      kind: 'dispatch',
      kernel: this.options.kernel,
      target,
      input: call.input,
      credentialIssuer: presented?.iss ?? null,
    })
    const input = call.input as { readonly name?: unknown }
    return {
      kind: 'value',
      invocation: { source: this.options.kernel, id: 'fake-admin-call' },
      value: { name: input.name },
    }
  }

  async call(): Promise<never> {
    throw new Error('the fake Admin kernel serves no graph call')
  }

  close(): void {}
}

/** A Domain bearer for the Kernel carrying the caller's identity proof, as an exchange returns. */
function domainCredential(issuer: string, kernel: string, expiresAt: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const proof = `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: kernel,
    sub: 'admin-user',
    aud: kernel,
    exp: expiresAt,
    delegation: { v: 1, expr: { kind: 'identity', id: 'admin-user' } },
  })}.signature`
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: issuer,
    sub: 'services-domain',
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
