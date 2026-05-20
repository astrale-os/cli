import { defineMethods } from '@astrale-os/kernel-runtime'

import { AstraleDomainSchema } from '../schema/schema.ts'
import { NoteMethods, NoteOpsMethods } from './note-ops.ts'

/**
 * Assembly — `createNote` is declared on the `NoteOps` interface, so its
 * impl goes under `interface:`. `addTag` is declared on the `Note` class,
 * so its impl goes under `class: { Note: … }`. See astrale-domain-dev →
 * schema-and-functions.md → "Assembly" for the bucket rule.
 *
 * This file is the in-process wiring consumed by `domainFixture({ schema,
 * methods })` (see test/astrale-domain.test.ts). The production remote
 * wiring lives in `../domain.ts` (via `defineRemoteDomain` + stubs) and is
 * what `astrale domain build` and `worker/src/index.ts` consume.
 */
export const methods = defineMethods(AstraleDomainSchema, {
  interface: {
    NoteOps: NoteOpsMethods,
  },
  class: {
    Note: NoteMethods,
  },
})
