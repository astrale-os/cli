import { defineMethods } from '@astrale-os/kernel-runtime'

import { MinimalRemoteSchema } from '../schema/schema.ts'
import { NoteOpsMethods } from './note-ops.ts'

/**
 * Assembly — `createNote` is declared on the `NoteOps` interface, so its
 * impl goes under `interface:`. A method declared on `Note` (class-level)
 * would go under `class: { Note: … }`. See astrale-domain-dev →
 * schema-and-functions.md → "Assembly" for the bucket rule.
 *
 * This file is the in-process wiring consumed by `domainFixture({ schema,
 * methods })` (see test/minimal-remote.test.ts). The production remote
 * wiring lives in `../domain.ts` (via `defineRemoteDomain` + stubs) and is
 * what `scripts/build-spec.ts` and `worker/src/index.ts` consume.
 */
export const methods = defineMethods(MinimalRemoteSchema, {
  interface: {
    NoteOps: NoteOpsMethods,
  },
  class: {},
})
