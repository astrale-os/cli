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

import { MINIMAL_BASE_DOMAIN, type MinimalRemoteSchema } from '../schema/schema.ts'

type M<N extends string> = MethodImpl<typeof MinimalRemoteSchema, 'NoteOps', N>

const NOTE_CLASS = ClassPath.parse(`/:${MINIMAL_BASE_DOMAIN}:class.Note`)

const createNote: M<'createNote'> = {
  execute: async ({ kernel, params }) => {
    const slug = `note-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const created = await kernel.graph.createNode({
      class: NOTE_CLASS,
      path: AbsolutePath.parse(`/${MINIMAL_BASE_DOMAIN}/${slug}`),
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
