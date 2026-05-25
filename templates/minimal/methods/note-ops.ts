/**
 * Impl for `NoteOps.createNote` — declared on the interface, so the impl
 * lives in the `interface:` bucket of `defineMethods` (see ./index.ts).
 *
 * Static interface method → `self` is `undefined`. Get the class path from
 * a module-level `ClassPath.parse(...)` literal, not from `self`.
 */
import type { MethodImpl } from '@astrale-os/kernel-runtime'

import { AbsolutePath, K } from '@astrale-os/kernel-core'
import { ClassPath } from '@astrale-os/kernel-core/domain'

import { ASTRALE_DOMAIN_BASE_DOMAIN, type AstraleDomainSchema } from '../schema/schema.ts'

type M<N extends string> = MethodImpl<typeof AstraleDomainSchema, 'NoteOps', N>

const NOTE_CLASS = ClassPath.parse(`/:${ASTRALE_DOMAIN_BASE_DOMAIN}:class.Note`)
const NAME_KEY = K.Named.name.key

const createNote: M<'createNote'> = {
  // `authorize` is mandatory on every method (kernel-runtime's
  // `validateHandlerShape` rejects handlers without it). For ops open to any
  // authenticated caller, return `undefined` — the kernel still enforces
  // `has_perm` on touched nodes independently. Tighten this when the
  // method's auth model becomes specific (e.g. `({ self }) => [{ nodes: [self.path], perm: USE }]`).
  authorize: async () => undefined,
  execute: async ({ kernel, params }) => {
    const slug = `note-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const path = `/${ASTRALE_DOMAIN_BASE_DOMAIN}/${slug}`
    const created = await kernel.graph.createNode({
      class: NOTE_CLASS,
      path: AbsolutePath.parse(path),
      props: { [NAME_KEY]: params.title, title: params.title, body: params.body },
    })
    // `createNote` returns a `NoteRef` `{ id, path }` (see schema/schema.ts).
    // Mirrors domains/contract.
    return { id: created.id, path }
  },
}

export const NoteOpsMethods = { createNote }
