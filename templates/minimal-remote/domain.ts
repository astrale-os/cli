/**
 * RemoteDomain definition for minimal-remote.
 *
 * Real execution happens in the CF Worker (minimal-remote/worker/).
 * This exists so `buildSpec(minimalRemoteDomain)` can produce a SpecGraphData
 * for kernel installation. The stub handlers are never executed; the worker
 * owns the real impl and the kernel only needs the schema shape for
 * authorization + routing.
 *
 * Each stub stamps `remoteUrl` so `extractBinding` emits `binding.remoteUrl`
 * on every Function node in the compiled spec. Clients use that URL to bypass
 * kernel dispatch and POST the envelope straight to the worker.
 */

import { defineRemoteDomain, type SchemaMethodsImpl } from '@astrale-os/sdk'

import { MinimalRemoteSchema } from './schema/schema.ts'

// `build-spec.ts` resolves the worker URL from the selected preset and
// sets MINIMAL_WORKER_URL before spawning the spec builder. Fall back to the
// prod URL so ad-hoc `buildSpec(minimalRemoteDomain)` calls still stamp a
// sensible remoteUrl.
const WORKER_URL =
  (typeof process !== 'undefined' && process.env?.MINIMAL_WORKER_URL) ||
  'https://minimal.test.astrale.ai'

// Never executed — real dispatch happens in the worker. The cast lets us
// satisfy the typed `SchemaMethodsImpl` slot without reconstructing every
// method's exact RemoteHandler signature just to throw it away.
// oxlint-disable-next-line no-explicit-any
const stub = { execute: async () => undefined, remoteUrl: WORKER_URL } as any

const stubs: SchemaMethodsImpl<typeof MinimalRemoteSchema> = {
  class: {},
  interface: {
    NoteOps: { createNote: stub },
  },
}

export const minimalRemoteDomain = defineRemoteDomain<void>()({
  schema: MinimalRemoteSchema,
  methods: stubs,
})
