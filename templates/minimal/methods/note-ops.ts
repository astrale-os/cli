/**
 * Impl for `NoteOps.createNote` — declared on the interface, so the impl
 * lives in the `interface:` bucket of `defineMethods` (see ./index.ts).
 *
 * Static interface method → `self` is `undefined`. Get the class path from
 * a module-level `ClassPath.parse(...)` literal, not from `self`.
 */
import type { MethodImpl } from '@astrale-os/kernel-runtime'

import { AbsolutePath } from '@astrale-os/kernel-core'
import { ClassPath } from '@astrale-os/kernel-core/domain'

import { ASTRALE_DOMAIN_BASE_DOMAIN, type AstraleDomainSchema } from '../schema/schema.ts'

type M<N extends string> = MethodImpl<typeof AstraleDomainSchema, 'NoteOps', N>

const NOTE_CLASS = ClassPath.parse(`/:${ASTRALE_DOMAIN_BASE_DOMAIN}:class.Note`)

const createNote: M<'createNote'> = {
  // `authorize` is mandatory on every method (kernel-runtime's
  // `validateHandlerShape` rejects handlers without it). For ops open to any
  // authenticated caller, return `undefined` — the kernel still enforces
  // `has_perm` on touched nodes independently. Tighten this when the
  // method's auth model becomes specific (e.g. `({ self }) => [{ nodes: [self.path], perm: USE }]`).
  authorize: async () => undefined,
  execute: async ({ kernel, params }) => {
    const slug = `note-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const created = await kernel.graph.createNode({
      class: NOTE_CLASS,
      path: AbsolutePath.parse(`/${ASTRALE_DOMAIN_BASE_DOMAIN}/${slug}`),
      props: { title: params.title, body: params.body },
    })
    // createNode returns a NodeResult; callers treat the return as a ref to
    // the new Note. The `returns: ref(SELF)` contract accepts the kernel's
    // native ref shape.
    // oxlint-disable-next-line no-explicit-any
    return created as any
  },
}

export const NoteOpsMethods = { createNote }
