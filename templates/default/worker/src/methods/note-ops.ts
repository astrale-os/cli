/**
 * Worker-side impls. Both are template stubs that demonstrate the wiring;
 * swap in real `kernel.call(...)` bodies once your domain has CRUD semantics.
 * See `domains/notes/worker/src/methods/note-ops.ts` for a fully-worked
 * example.
 *
 *   - `createNote` (interface `NoteOps`, static)  → returns a synthetic ref.
 *   - `addTag`     (class `Note`, instance)       → returns a path derived
 *                                                   from `self.path`.
 *
 * Interface-hosted methods have no class-aware factory (only `remoteMethod`
 * for class methods exists today); author them as a plain object — the
 * `interface:` bucket of `SchemaMethodsImpl` accepts an `InterfaceMethodHandler`
 * shape (`{ remoteUrl?, authorize?, execute }`).
 */
import { remoteMethod } from '@astrale-os/sdk'

import type { Env } from '../env.ts'

import { WorkerSchema } from '../schema.ts'

const method = remoteMethod<Env>()

// oxlint-disable-next-line no-explicit-any
export const createNote: any = {
  authorize: async () => undefined,
  execute: async ({ params }) => {
    const slug = `note-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    return { id: slug, path: `/${slug}`, title: params.title }
  },
}

export const addTag = method(WorkerSchema, 'Note', 'addTag', {
  authorize: async () => undefined,
  execute: async ({ self, params }) => {
    const tagPath = self.path.append(`tag-${params.tag.replace(/[^a-z0-9-]+/gi, '-')}`)
    return { path: tagPath.toString() }
  },
})
