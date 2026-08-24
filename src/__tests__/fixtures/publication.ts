import type { schema } from '@astrale-os/sdk/schema'

import { defineApplication } from '@astrale-os/sdk/application'
import { compile } from '@astrale-os/sdk/deployment/build'
import { addressing, assemble } from '@astrale-os/sdk/deployment/release'
import { defineRuntime } from '@astrale-os/sdk/runtime'

/** Build a canonical empty-runtime Release for cross-boundary CLI tests. */
export function releaseFor<const Schema extends schema.DomainSchema>(
  source: Schema,
  issuer: string,
) {
  const runtime = defineRuntime<Schema>()({
    integrations: {},
    initialize: () => ({ providers: {} }),
    actions: [],
    workflows: [],
  })
  return assemble(compile(defineApplication({ schema: source, runtime })), addressing(issuer))
}
