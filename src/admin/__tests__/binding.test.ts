import type { ClientSession } from '@astrale-os/kernel-client/session'

import { defineDomain } from '@astrale-os/sdk'
import { issuer } from '@astrale-os/sdk/auth'
import { createDeployment } from '@astrale-os/sdk/deployment'
import { defineSchema } from '@astrale-os/sdk/schema/v1'
import { expect, mock, test } from 'bun:test'

import { bindAdmin } from '../binding'

const schema = defineSchema('admin.astrale.ai', {})
const deployment = createDeployment({
  definition: defineDomain({
    schema,
    handlers: { functions: {}, classes: {}, interfaces: {} },
  }),
  issuer: issuer.accept('https://admin.beta.astrale.ai'),
  bundleHref: 'https://admin.beta.astrale.ai/domain.bundle.json',
  bindings: { callables: [] },
})

test('binds the installed Admin Domain instead of the source Kernel publication', async () => {
  const installation = mock(async () => ({
    state: 'ready' as const,
    target: 'sha256:admin-target' as const,
    source: { kind: 'remote' as const, publication: deployment.publication },
    bundle: deployment.bundle,
    readiness: 'sha256:admin-readiness' as const,
    capabilities: { requested: [], materialized: [] },
  }))
  const session = { installation } as unknown as ClientSession

  const binding = await bindAdmin(session)

  expect(installation).toHaveBeenCalledWith('admin.astrale.ai')
  expect(binding.$.origin).toBe('admin.astrale.ai')
  expect(String(binding.$.publication?.identity.issuer)).toBe('https://admin.beta.astrale.ai')
})
