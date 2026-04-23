/**
 * Minimal remote-domain schema.
 *
 * Intentionally the smallest thing that exercises every domain concern:
 *   - one Class (`Note`) with two own props,
 *   - one Interface (`NoteOps`) with one static method that creates a Note,
 *   - one Edge class (`references`) linking Note → Note.
 *
 * Everything beyond this — additional classes, inheritance, streams,
 * complex auth expressions — is domain-specific. Start here, grow from here.
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
 * Interface hosting the sole static op. Because `createNote` is declared on
 * the interface (not on `Note`), its impl MUST live under `interface:` in
 * `defineMethods` — see astrale-domain-dev → schema-and-functions.md.
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

export const Note = nodeClass({
  implements: [NoteOps, KernelSchema.interfaces.Container],
  props: {
    title: z.string(),
    body: z.string(),
  },
  methods: {},
})

export const references = edgeClass(
  { as: 'from_note', types: [Note] },
  { as: 'to_note', types: [Note] },
  { props: { reason: z.string().optional() } },
)

// Base domain is env-driven so tests and prod share one invariant:
// schema.domain == worker issuer == identity-binding iss == kernel path
// prefix. Flipping MINIMAL_BASE_DOMAIN reconfigures everything downstream.
export const MINIMAL_BASE_DOMAIN =
  (typeof process !== 'undefined' && process.env?.MINIMAL_BASE_DOMAIN) || 'minimal.test.astrale.ai'

export const MinimalRemoteSchema = defineSchema(MINIMAL_BASE_DOMAIN, {
  interfaces: { NoteOps },
  classes: { Note, references },
  imports: [KernelSchema],
})
