/**
 * Smoke test for the astrale-domain scaffold.
 *
 * Uses `domainFixture` in standalone in-process mode: it spins up a fresh
 * FalkorDB graph (via testcontainers), installs the compiled schema,
 * and calls `createNote`.
 *
 * No worker, no tunnel, no wrangler — this is the fastest feedback loop
 * for iterating on schema + methods. Once this passes, move on to
 * `pnpm infra:prepare` for the full worker/tunnel cycle.
 *
 * In-process `domainFixture` provides a system credential with full access —
 * no explicit grants are needed for the smoke test. Use
 * `authz().grantAccess(...)` (see `kernel/domains/test/scenarios/s07-permissions.test.ts`)
 * for non-system grants.
 */
import { abs } from '@astrale-os/kernel-core'
import { domainFixture } from '@astrale-os/kernel-test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { methods } from '../methods/index.ts'
import { AstraleDomainSchema } from '../schema/schema.ts'

const fx = domainFixture({ schema: AstraleDomainSchema, methods })

describe('astrale-domain', () => {
  fx.install({ beforeAll, afterAll })

  it('createNote creates a Note and returns a ref', async () => {
    const { call, domain } = fx.ctx
    const origin = domain.origin

    const res = await call(abs`/${origin}/interface.NoteOps/createNote`, {
      title: 'Hello',
      body: 'World',
    })

    expect(res).toBeDefined()
  })
})
