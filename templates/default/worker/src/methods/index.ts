import { remoteClassMethods, type SchemaMethodsImpl } from '@astrale-os/sdk'

import type { Env } from '../env.ts'

import { WorkerSchema } from '../schema.ts'
import { addTag, createNote } from './note-ops.ts'

const classMethods = remoteClassMethods<Env>()

const NoteMethods = classMethods(WorkerSchema, 'Note', { addTag })

/**
 * Worker methods. `interface:` is populated — the kernel CLI emits Function
 * subs for `interface.NoteOps:createNote` (see
 * `cli/src/lib/domain-identity.ts`), so the install path works end-to-end.
 */
export const workerMethods: SchemaMethodsImpl<typeof WorkerSchema, Env> = {
  class: {
    Note: NoteMethods,
  },
  interface: {
    NoteOps: { createNote },
  },
}
