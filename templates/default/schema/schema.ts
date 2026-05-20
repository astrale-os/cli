import { DistributionSchema } from '@astrale-os/distribution-domain/schema'
/**
 * Default remote-domain schema — demonstrates the full Astrale feature set:
 * Interface + Class with both static and instance methods + edge + View +
 * RemoteFunction + core genesis + lifecycle hooks.
 *
 *   - Interface `NoteOps` with one static op (`createNote`). Its impl lives
 *     under `interface:` in `defineMethods` — see astrale-domain-dev →
 *     schema-and-functions.md. The kernel CLI emits Function subs for both
 *     `class.X:M` and `interface.X:M` (see `cli/src/lib/domain-identity.ts`),
 *     so interface-hosted methods work end-to-end.
 *   - Class `Note` implements `[NoteOps, KernelSchema.interfaces.Container]`,
 *     inheriting `createNote` (static) and adding `addTag` (instance — uses
 *     `self.path` to scope the operation to a specific Note).
 *   - Edge `references` linking Note → Note.
 *
 * `View` (`ui-note`) and `RemoteFunction` (`count`) are NOT declared here —
 * they are auto-materialized by the SDK from the `views` / `remoteFunctions`
 * maps passed to `defineRemoteDomain` in domain.ts. They reuse the `View`,
 * `view_for`, and `RemoteFunction` classes from the `distribution` domain
 * (imported below).
 */
import {
  defineSchema,
  edgeClass,
  KernelSchema,
  nodeClass,
  nodeInterface,
} from '@astrale-os/kernel-core'
import { fn, ref, SELF } from '@astrale-os/kernel-dsl'
import { z } from 'zod'

/**
 * Interface hosting the static op. Static op → `self` is `undefined`; get
 * the class path from a module-level `ClassPath.parse(...)` literal in the
 * impl, not from `self`.
 */
export const NoteOps = nodeInterface({
  methods: {
    createNote: fn({
      static: true,
      params: { title: z.string(), body: z.string() },
      returns: ref(SELF),
    }),
  },
})

/**
 * `addTag` is class-hosted and non-static — its impl receives `self`, a
 * `WithNodeId<MethodSelf<…>>` that exposes the target node's `path`. Use it
 * to scope per-instance work (e.g. `self.path.append('tag-' + name)`).
 */
export const Note = nodeClass({
  implements: [NoteOps, KernelSchema.interfaces.Container],
  props: {
    title: z.string(),
    body: z.string(),
  },
  methods: {
    addTag: fn({
      params: { tag: z.string() },
      returns: z.object({ path: z.string() }),
    }),
  },
})

export const references = edgeClass(
  { as: 'from_note', types: [Note] },
  { as: 'to_note', types: [Note] },
  { props: { reason: z.string().optional() } },
)

// Base domain is env-driven so tests and prod share one invariant:
// schema.domain == worker issuer == identity-binding iss == kernel path
// prefix. Flipping ASTRALE_DOMAIN_BASE_DOMAIN reconfigures everything downstream.
//
// `process` is read at build time (build-spec runs on Node). The worker
// bundle never executes this branch — Workers don't have `process` and
// the WebWorker tsconfig lib doesn't declare it. Narrow access through
// globalThis so both environments typecheck.
type MaybeNodeGlobal = { process?: { env?: Record<string, string | undefined> } }
const _maybeNode = globalThis as unknown as MaybeNodeGlobal
export const ASTRALE_DOMAIN_BASE_DOMAIN =
  _maybeNode.process?.env?.ASTRALE_DOMAIN_BASE_DOMAIN ?? 'astrale-domain.test.astrale.ai'

export const AstraleDomainSchema = defineSchema(ASTRALE_DOMAIN_BASE_DOMAIN, {
  interfaces: { NoteOps },
  classes: { Note, references },
  imports: [KernelSchema, DistributionSchema],
})
