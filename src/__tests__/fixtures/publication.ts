import type { schema } from '@astrale-os/sdk/schema'

import { compile } from '@astrale-os/sdk/deployment/build'
import { assemble } from '@astrale-os/sdk/deployment/release'
import { defineDomain } from '@astrale-os/sdk/domain'
import { defineRuntime } from '@astrale-os/sdk/runtime'

/**
 * Build the `DomainRelease` v4 one immutable deployment of an empty runtime serves at `url`
 * (its issuer), with a fixed build digest, for cross-boundary CLI tests.
 */
export function deploymentReleaseFor<const Schema extends schema.DomainSchema>(
  source: Schema,
  url: string,
  build: `sha256:${string}` = `sha256:${'b'.repeat(64)}`,
) {
  const runtime = defineRuntime<Schema>()({
    integrations: {},
    initialize: () => ({ providers: {} }),
    functions: [],
  })
  return assemble(compile(defineDomain({ schema: source, runtime })), build, url)
}
