/**
 * Worker-side impls — the production path (this is what ships and runs on
 * Cloudflare). Mirror the in-process fixture (`../../methods/note-ops.ts`):
 * same inputs, same results, but via `kernel.call(...)` against the universal
 * Node syscalls instead of the in-process graph port.
 *
 *   - `createNote` (interface `NoteOps`, static)  → creates a real Note node.
 *   - `reference`  (class `Note`, instance)        → creates a real
 *                                                    `references` edge via `::link`.
 *
 * Typing: `createNote` (interface-hosted) via `remoteInterfaceMethods<Env>()`,
 * the interface counterpart of `remoteClassMethods` — no more `any`.
 * `reference` (class-hosted) via `remoteMethod<Env>()`.
 */
import { K } from '@astrale-os/kernel-core'
import { ClassPath } from '@astrale-os/kernel-core/domain'
import { remoteInterfaceMethods, remoteMethod } from '@astrale-os/sdk'

import type { Env } from '../env.ts'

import { ASTRALE_DOMAIN_BASE_DOMAIN } from '../../../schema/schema.ts'
import { WorkerSchema } from '../schema.ts'

const method = remoteMethod<Env>()
const interfaceMethods = remoteInterfaceMethods<Env>()

// `kernel.call` takes the universal syscall path + raw path strings (see
// domains/contract/worker for the canonical pattern). ClassPath `.raw` gives
// the canonical `/:<domain>:class.<Name>` form the syscalls expect.
const NODE_CREATE = K.Node.createNode.path.method.raw
const NAME_KEY = K.Named.name.key
const NOTE_CLASS = ClassPath.parse(`/:${ASTRALE_DOMAIN_BASE_DOMAIN}:class.Note`).raw
const REFERENCES_CLASS = ClassPath.parse(`/:${ASTRALE_DOMAIN_BASE_DOMAIN}:class.references`).raw

export const NoteOpsMethods = interfaceMethods(WorkerSchema, 'NoteOps', {
  createNote: {
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

export const reference = method(WorkerSchema, 'Note', 'reference', {
  // SDK-level `authorize` is a throw-to-deny additive check (returns void);
  // the authoritative permission requirement is the kernel-runtime form shown
  // in ../../methods/note-ops.ts. For fine-grained worker checks, see the
  // `assertPerm` / `requireOwnership` helpers exported from `@astrale-os/sdk`.
  authorize: async () => undefined,
  execute: async ({ kernel, self, params }) => {
    if (!kernel) throw new Error('reference requires a credential')
    // Create a real `references` edge from this Note to the target Note.
    // `::link` accepts any path form for `target` (absolute or `@<id>`).
    await kernel.call(`${self.path.raw}::link`, {
      edgeClass: REFERENCES_CLASS,
      target: params.target,
    })
    return { linked: params.target }
  },
})
