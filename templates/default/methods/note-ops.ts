/**
 * In-process fixture impls for `NoteOps.createNote` (interface-hosted,
 * static) and `Note.reference` (class-hosted, instance — uses `self.path`).
 *
 * These talk to the graph port directly (`kernel.graph.*`). The production
 * path is the worker (`worker/src/methods/`), which does the same thing
 * through `kernel.call(...)`. Keep the two in sync: same inputs, same result.
 *
 * `reference.authorize` returns a real permission requirement
 * (`[{ nodes: [self.path], perm: USE }]`) — the kernel-runtime authorize shape,
 * the one place the template makes authorization visible. The smoke test runs
 * under the system credential (full access), so it passes; see
 * `kernel/.../scenarios/s07-permissions.test.ts` to exercise the *denied* path
 * with a restricted actor.
 */
import type { MethodImpl } from '@astrale-os/kernel-runtime'

import { AbsolutePath, K, USE } from '@astrale-os/kernel-core'
import { ClassPath } from '@astrale-os/kernel-core/domain'

import { ASTRALE_DOMAIN_BASE_DOMAIN, type AstraleDomainSchema } from '../schema/schema.ts'

type IM<N extends string> = MethodImpl<typeof AstraleDomainSchema, 'NoteOps', N>
type CM<N extends string> = MethodImpl<typeof AstraleDomainSchema, 'Note', N>

const NOTE_CLASS = ClassPath.parse(`/:${ASTRALE_DOMAIN_BASE_DOMAIN}:class.Note`)
const REFERENCES_CLASS = ClassPath.parse(`/:${ASTRALE_DOMAIN_BASE_DOMAIN}:class.references`)
const NAME_KEY = K.Named.name.key

const createNote: IM<'createNote'> = {
  // `authorize` is mandatory on every method. `undefined` means "any
  // authenticated caller" — the kernel still enforces `has_perm` independently.
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

const reference: CM<'reference'> = {
  // Real authorization: invoking `reference` requires USE on the source Note.
  // `authorize` returns the permission requirement; the kernel checks it
  // against the caller's `has_perm` independently. Return `undefined` for
  // "any authenticated caller" (as `createNote` does above).
  authorize: async ({ self }) => [{ nodes: [self.path], perm: USE }],
  execute: async ({ kernel, self, params }) => {
    // Instance method: `self.path` is the source Note. Create a real
    // `references` edge to the target Note (addressed by path string).
    await kernel.graph.createEdge({
      class: REFERENCES_CLASS,
      source: self.path,
      target: AbsolutePath.parse(params.target),
    })
    return { linked: params.target }
  },
}

export const NoteOpsMethods = { createNote }
export const NoteMethods = { reference }
