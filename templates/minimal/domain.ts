/**
 * RemoteDomain definition for astrale-domain — consumed by both `buildSpec`
 * (to produce the SpecGraphData the kernel installs) AND the CF Worker
 * (`worker/src/index.ts` serves this very def via `createRemoteServer`).
 *
 * Because the minimal worker has no env-specific deps, the real `createNote`
 * impl lives right here — there is no separate worker-local
 * `defineRemoteDomain<Env>()` (contrast the `default` template). `buildSpec`
 * reads `schema` + `binding` and never runs `execute`, so a real body is inert
 * at build time; at runtime the worker runs it for real.
 *
 * The handler stamps `remoteUrl` so `extractBinding` emits `binding.remoteUrl`
 * on the Function node. Clients use that URL to bypass kernel dispatch and POST
 * the envelope straight to the worker.
 */

import { K } from '@astrale-os/kernel-core'
import { ClassPath } from '@astrale-os/kernel-core/domain'
import { defineRemoteDomain, remoteInterfaceMethods, type SchemaMethodsImpl } from '@astrale-os/sdk'

import { ASTRALE_DOMAIN_BASE_DOMAIN, AstraleDomainSchema } from './schema/schema.ts'

// `astrale domain build` sets ASTRALE_DOMAIN_WORKER_URL from the active preset
// before spawning the spec builder; fall back to prod so ad-hoc `buildSpec(...)`
// calls still stamp a sensible remoteUrl. `process` exists at build (Node)
// but not at runtime (Worker, lib: ["WebWorker"]) — narrow via globalThis
// so both environments typecheck.
type MaybeNodeGlobal = { process?: { env?: Record<string, string | undefined> } }
const nodeGlobal = globalThis as unknown as MaybeNodeGlobal
const WORKER_URL =
  nodeGlobal.process?.env?.ASTRALE_DOMAIN_WORKER_URL ?? 'https://astrale-domain.test.astrale.ai'

// `kernel.call` takes the universal syscall path + raw path strings. ClassPath
// `.raw` gives the canonical `/:<domain>:class.<Name>` form the syscalls want.
const NODE_CREATE = K.Node.createNode.path.method.raw
const NAME_KEY = K.Named.name.key
const NOTE_CLASS = ClassPath.parse(`/:${ASTRALE_DOMAIN_BASE_DOMAIN}:class.Note`).raw

const interfaceMethods = remoteInterfaceMethods<void>()

const NoteOpsMethods = interfaceMethods(AstraleDomainSchema, 'NoteOps', {
  createNote: {
    remoteUrl: WORKER_URL,
    // `authorize` returning `undefined` = "any authenticated caller"; the
    // kernel still enforces `has_perm` independently. Tighten when the op's
    // auth model becomes specific.
    authorize: async () => undefined,
    execute: async ({ kernel, params }) => {
      if (!kernel) throw new Error('createNote requires a credential')
      const slug = `note-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const path = `/${ASTRALE_DOMAIN_BASE_DOMAIN}/${slug}`
      const created = (await kernel.call(NODE_CREATE, {
        class: NOTE_CLASS,
        path,
        props: { [NAME_KEY]: params.title, title: params.title, body: params.body },
      })) as { id: string }
      // `createNote` returns a `NoteRef` `{ id, path }` (see schema).
      // `kernel.call` returns `unknown`, hence the narrow. Mirrors contract.
      return { id: created.id, path }
    },
  },
})

const methods: SchemaMethodsImpl<typeof AstraleDomainSchema, void> = {
  class: {},
  interface: {
    NoteOps: NoteOpsMethods,
  },
}

export const astraleDomainDef = defineRemoteDomain<void>()({
  schema: AstraleDomainSchema,
  methods,
})
