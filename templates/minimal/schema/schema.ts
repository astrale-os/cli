/**
 * Minimal remote-domain schema.
 *
 * Intentionally the smallest thing that exercises a domain end-to-end:
 *   - one Class (`Note`) with two own props,
 *   - one Interface (`NoteOps`) with one static method that creates a Note.
 *
 * Everything beyond this — additional classes, edges, inheritance, streams,
 * complex auth expressions — is domain-specific. Start here, grow from here.
 * (The `default` template showcases an edge class, an instance method, and a
 * real `authorize` expression.)
 */
import { defineSchema, KernelSchema, nodeClass, nodeInterface } from '@astrale-os/kernel-core'
import { fn } from '@astrale-os/kernel-dsl'
import { z } from 'zod'

/**
 * Return shape for "I created a node" methods. Remote methods return a plain
 * `{ id, path }` ref — NOT `ref(SELF)`, whose full-Node value doesn't
 * round-trip over the worker wire. Mirrors domains/contract's `NodeRef`.
 */
const NoteRef = z.object({ id: z.string(), path: z.string() })

/**
 * Interface hosting the sole static op. Because `createNote` is declared on
 * the interface (not on `Note`), its impl MUST live under `interface:` in
 * `defineMethods` — see astrale-domain-dev → schema-and-functions.md.
 */
export const NoteOps = nodeInterface({
  methods: {
    createNote: fn({
      static: true,
      params: { title: z.string(), body: z.string() },
      returns: NoteRef,
    }),
  },
})

export const Note = nodeClass({
  implements: [NoteOps, KernelSchema.interfaces.Container],
  props: {
    title: z.string(),
    body: z.string(),
  },
  methods: {},
})

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
  classes: { Note },
  imports: [KernelSchema],
})
