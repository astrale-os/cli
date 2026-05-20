/**
 * In-process fixture impls for `NoteOps.createNote` (interface-hosted,
 * static) and `Note.addTag` (class-hosted, instance — uses `self.path`).
 *
 * These talk to the graph port directly (`kernel.graph.*`). The production
 * path is the worker (`worker/src/methods/`), which does the same thing
 * through the SDK's `remoteMethod<Env>()` factory.
 */
import type { MethodImpl } from '@astrale-os/kernel-runtime'

import { AbsolutePath, K } from '@astrale-os/kernel-core'
import { ClassPath } from '@astrale-os/kernel-core/domain'

import { ASTRALE_DOMAIN_BASE_DOMAIN, type AstraleDomainSchema } from '../schema/schema.ts'

type IM<N extends string> = MethodImpl<typeof AstraleDomainSchema, 'NoteOps', N>
type CM<N extends string> = MethodImpl<typeof AstraleDomainSchema, 'Note', N>

const NOTE_CLASS = ClassPath.parse(`/:${ASTRALE_DOMAIN_BASE_DOMAIN}:class.Note`)
const NAME_KEY = K.Named.name.key

const createNote: IM<'createNote'> = {
  // `authorize` is mandatory on every method. `undefined` means "any
  // authenticated caller" — the kernel still enforces `has_perm` independently.
  authorize: async () => undefined,
  execute: async ({ kernel, params }) => {
    const slug = `note-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const created = await kernel.graph.createNode({
      class: NOTE_CLASS,
      path: AbsolutePath.parse(`/${ASTRALE_DOMAIN_BASE_DOMAIN}/${slug}`),
      props: { [NAME_KEY]: params.title, title: params.title, body: params.body },
    })
    // oxlint-disable-next-line no-explicit-any
    return created as any
  },
}

const addTag: CM<'addTag'> = {
  authorize: async () => undefined,
  execute: async ({ self, params }) => {
    // Instance method: `self.path` is the path of the Note this method was
    // invoked on. Real impls would create a Tag node + edge here; this stub
    // just demonstrates the `self.path` accessor.
    const tagPath = self.path.append(`tag-${params.tag.replace(/[^a-z0-9-]+/gi, '-')}`)
    return { path: tagPath.toString() }
  },
}

export const NoteOpsMethods = { createNote }
export const NoteMethods = { addTag }
