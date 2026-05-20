/**
 * Smoke tests for the default scaffold.
 *
 * Uses `domainFixture` in standalone in-process mode: it spins up a fresh
 * FalkorDB graph (via testcontainers), installs the compiled schema, and
 * exercises both `NoteOps.createNote` (interface-hosted, static) and
 * `Note.addTag` (class-hosted, instance).
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
    })) as { path: string }

    expect(res).toBeDefined()
    expect(res.path).toContain(origin)
  })

  it('addTag (class-hosted, instance) uses self.path', async () => {
    const { call, domain } = fx.ctx
    const origin = domain.origin

    const note = (await call(abs`/${origin}/interface.NoteOps/createNote`, {
      title: 'Taggable',
      body: 'Body',
    })) as { path: string }

    const tagged = (await call(abs`${note.path}::addTag`, { tag: 'urgent' })) as { path: string }

    expect(tagged.path).toContain(note.path)
    expect(tagged.path).toContain('tag-urgent')
  })
})
