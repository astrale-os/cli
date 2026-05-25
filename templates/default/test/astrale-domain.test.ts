/**
 * Smoke tests for the default scaffold.
 *
 * Uses `domainFixture` in standalone in-process mode: it spins up a fresh
 * FalkorDB graph (via testcontainers), installs the compiled schema, and
 * exercises both `NoteOps.createNote` (interface-hosted, static) and
 * `Note.reference` (class-hosted, instance — creates a `references` edge).
 *
 * No worker, no tunnel, no wrangler — this is the fastest feedback loop for
 * iterating on schema + methods. Once this passes, move on to
 * `astrale domain dev up` for the full worker/tunnel cycle.
 *
 * In-process `domainFixture` provides a system credential with full access —
 * no explicit grants are needed for the smoke test.
 */
import { abs } from '@astrale-os/kernel-core'
import { domainFixture } from '@astrale-os/kernel-test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { methods } from '../methods/index.ts'
import { AstraleDomainSchema } from '../schema/schema.ts'

const fx = domainFixture({ schema: AstraleDomainSchema, methods })

describe('astrale-domain', () => {
  fx.install({ beforeAll, afterAll })

  it('createNote (interface-hosted, static) creates a Note', async () => {
    const { call, domain } = fx.ctx
    const origin = domain.origin

    const res = (await call(abs`/${origin}/interface.NoteOps/createNote`, {
      title: 'Hello',
      body: 'World',
    })) as { id: string; path: string }

    expect(res.id).toBeTruthy()
    expect(res.path).toContain(origin)
  })

  it('reference (class-hosted, instance) creates a real references edge', async () => {
    const { call, domain, expectEdge } = fx.ctx
    const origin = domain.origin

    const a = (await call(abs`/${origin}/interface.NoteOps/createNote`, {
      title: 'A',
      body: 'source',
    })) as { id: string; path: string }
    const b = (await call(abs`/${origin}/interface.NoteOps/createNote`, {
      title: 'B',
      body: 'target',
    })) as { id: string; path: string }

    // Instance dispatch on Note A — address it by `@<id>` (`abs` is for
    // absolute paths only and rejects the `::method` suffix). Links A → B.
    const res = (await call(`@${a.id}::reference`, { target: b.path })) as { linked: string }
    expect(res.linked).toBe(b.path)

    // The instance method created a real `references` edge A → B. (The smoke
    // test runs under the system credential, so `reference`'s USE requirement
    // is satisfied — see methods/note-ops.ts and s07-permissions.test.ts for
    // the denied path.)
    await expectEdge(a.path, 'references', b.path).toExist()
  })
})
