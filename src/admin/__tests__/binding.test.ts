import type { ClientSession } from '@astrale-os/sdk/client/session'

import { bundle, defineSchema, schema as schemaApi } from '@astrale-os/sdk/schema'
import { expect, mock, test } from 'bun:test'

import { releaseFor } from '../../__tests__/fixtures/publication'
import { bindAdmin } from '../binding'

const schema = defineSchema('admin.astrale.ai', {})
const release = releaseFor(schema, 'https://admin.beta.astrale.ai')

test('binds the installed Admin Domain instead of the source Kernel publication', async () => {
  const loadBundle = mock(async () => ({
    domain: {
      origin: schema.origin,
      revision: schemaApi.revision(schema),
      generation: 'sha256:admin-generation',
      publication: release.publication,
      readiness: 'sha256:admin-readiness',
      capabilities: { requested: {}, materialized: {} },
      bindings: { callables: [], views: [] },
    },
    bundle: bundle.create(schema),
  }))
  const session = {
    schema: { bundle: loadBundle },
    bind: (domain: unknown) => ({ domain, graph: {} }),
  } as unknown as ClientSession

  const binding = await bindAdmin(session)

  expect(loadBundle).toHaveBeenCalledWith('admin.astrale.ai')
  expect(binding.domain.origin).toBe('admin.astrale.ai')
  expect(binding.domain.revision).toBe(schemaApi.revision(schema))
})
