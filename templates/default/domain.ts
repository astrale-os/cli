/**
 * RemoteDomain definition for astrale-domain — top-level (used by `buildSpec`).
 *
 * This file is imported by Node tooling (`astrale domain build`) to produce
 * `spec.json`. The stub handlers here NEVER execute — the kernel resolver
 * short-circuits to `binding.remoteUrl` and forwards calls to the worker.
 *
 * The REAL impls live in `worker/src/index.ts`, which builds a parallel
 * `defineRemoteDomain<Env>()` with the same shape but real `execute` bodies
 * (including the `count` RemoteFunction that uses the `kernel` field on
 * `RemoteFunctionContext`).
 *
 * Each stub stamps `remoteUrl` so `extractBinding` emits `binding.remoteUrl`
 * on every Function node in the compiled spec. Clients use that URL to bypass
 * kernel dispatch and POST the envelope straight to the worker.
 *
 * Views (`ui-note`) and RemoteFunctions (`count`) are auto-materialized by
 * the SDK from the maps below — `extendCore` adds the `/views/` and
 * `/functions/` Folders, View / RemoteFunction nodes (slug = map key), and
 * `view_for` edges. No need to author them in `core.ts`.
 */

import { DistributionSchema } from '@astrale-os/distribution-domain/schema'
import { selfOf } from '@astrale-os/kernel-dsl'
import {
  defineRemoteDomain,
  defineRemoteFunction,
  defineView,
  type SchemaMethodsImpl,
} from '@astrale-os/sdk'
import { z } from 'zod'

import { AstraleDomainCore } from './core.ts'
import { AstraleDomainSchema, Note } from './schema/schema.ts'

const { View, view_for, RemoteFunction } = DistributionSchema.classes

// `astrale domain build` sets ASTRALE_DOMAIN_WORKER_URL from the active preset
// before spawning the spec builder; fall back to prod so ad-hoc `buildSpec(...)`
// calls still stamp a sensible remoteUrl. `process` exists at build (Node) but
// not at runtime (Worker, lib: ["WebWorker"]) — narrow via globalThis so both
// environments typecheck.
type MaybeNodeGlobal = { process?: { env?: Record<string, string | undefined> } }
const nodeGlobal = globalThis as unknown as MaybeNodeGlobal
const WORKER_URL =
  nodeGlobal.process?.env?.ASTRALE_DOMAIN_WORKER_URL ?? 'https://astrale-domain.test.astrale.ai'

// Never executed — real dispatch happens in the worker. The cast lets us
// satisfy the typed `SchemaMethodsImpl` slot without reconstructing every
// method's exact RemoteHandler signature just to throw it away.
// oxlint-disable-next-line no-explicit-any
const stub = { execute: async () => undefined, remoteUrl: WORKER_URL } as any

const stubs: SchemaMethodsImpl<typeof AstraleDomainSchema> = {
  class: {
    Note: { addTag: stub },
  },
  interface: {
    NoteOps: { createNote: stub },
  },
}

export const astraleDomainDef = defineRemoteDomain<void>()({
  schema: AstraleDomainSchema,
  methods: stubs,
  core: AstraleDomainCore,
  workerUrl: WORKER_URL,

  viewClass: View,
  viewForEdgeClass: view_for,
  views: {
    'ui-note': defineView({
      auth: 'public',
      viewFor: selfOf(Note),
      // Worker mounts the real route at GET /views/ui-note via createRemoteServer.
      // This top-level render is never invoked.
      render: ({ c }) => c.redirect('/ui/note'),
    }),
  },

  remoteFunctionClass: RemoteFunction,
  remoteFunctions: {
    count: defineRemoteFunction({
      inputSchema: z.object({}),
      outputSchema: z.object({ count: z.number() }),
      // Stub — real impl in worker/src/index.ts uses `kernel` from
      // RemoteFunctionContext to count Notes under the domain origin.
      execute: async () => {
        throw new Error('astrale-domain.count: top-level stub should never execute')
      },
    }),
  },
})
