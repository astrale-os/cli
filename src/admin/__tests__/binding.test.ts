import type { ClientSession } from '@astrale-os/sdk/client/session'

import { bundle, defineSchema, schema as schemaApi } from '@astrale-os/sdk/schema'
import { expect, mock, test } from 'bun:test'

import { releaseFor } from '../../__tests__/fixtures/publication'
import { bindAdmin } from '../binding'

const schema = defineSchema('admin.astrale.ai', {})
const release = releaseFor(schema, 'https://admin.beta.astrale.ai')

test('binds the installed Admin Domain instead of the source Kernel publication', async () => {
  const installation = mock(async () => ({
    state: 'ready' as const,
    target: 'sha256:admin-target' as const,
    source: { kind: 'remote' as const, publication: release.publication },
    bundle: bundle.create(schema),
    readiness: 'sha256:admin-readiness' as const,
    capabilities: { requested: [], materialized: [] },
  }))
  const session = {
    installation,
    bind: (domain: unknown) => ({ domain, graph: {} }),
  } as unknown as ClientSession

  const binding = await bindAdmin(session)

  expect(installation).toHaveBeenCalledWith('admin.astrale.ai')
  expect(binding.domain.origin).toBe('admin.astrale.ai')
  expect(binding.domain.revision).toBe(schemaApi.revision(schema))
})
