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

// `build-spec.ts` sets MINIMAL_WORKER_URL from the active preset before
// spawning the spec builder; fall back to prod so ad-hoc `buildSpec(...)`
// calls still stamp a sensible remoteUrl. `process` exists at build (Node)
// but not at runtime (Worker, lib: ["WebWorker"]) — narrow via globalThis
// so both environments typecheck.
type MaybeNodeGlobal = { process?: { env?: Record<string, string | undefined> } }
const nodeGlobal = globalThis as unknown as MaybeNodeGlobal
const WORKER_URL = nodeGlobal.process?.env?.MINIMAL_WORKER_URL ?? 'https://minimal.test.astrale.ai'

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
