import type { schema } from '@astrale-os/sdk/schema'

import { defineApplication } from '@astrale-os/sdk/application'
import { compile } from '@astrale-os/sdk/deployment/build'
import { addressing, assemble, legacy } from '@astrale-os/sdk/deployment/release'
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
  return legacy.assemble(
    compile(defineApplication({ schema: source, runtime })),
    addressing(issuer),
  )
}

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
  return assemble(compile(defineApplication({ schema: source, runtime })), build, url)
}
