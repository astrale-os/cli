import type { schema } from '@astrale-os/sdk/schema'

import { compile } from '@astrale-os/sdk/deployment/build'
import { addressing, legacy } from '@astrale-os/sdk/deployment/release'
import { defineDomain } from '@astrale-os/sdk/domain'
import { defineRuntime } from '@astrale-os/sdk/runtime'

/**
 * Build the legacy v3 (stable-target) Release of an empty runtime, whose Publication is what the
 * CLI's domain.json reader admits, for cross-boundary CLI tests.
 */
export function releaseFor<const Schema extends schema.DomainSchema>(
  source: Schema,
  issuer: string,
) {
  const runtime = defineRuntime<Schema>()({
    integrations: {},
    initialize: () => ({ providers: {} }),
    functions: [],
  })
  return legacy.assemble(compile(defineDomain({ schema: source, runtime })), addressing(issuer))
}
