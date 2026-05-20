/**
 * Install-time genesis data (template demo).
 *
 * One welcome Note seeded under the domain origin (slug = map key).
 * Demonstrates the `defineCore` + `node()` pattern with a single node and
 * no edges — extend or remove at will.
 *
 * Genesis nodes are materialized when `astrale instance install spec.json`
 * runs; they exist by virtue of the domain being installed and do not
 * depend on any caller credential. For anything that needs a user (or a
 * cross-domain folder like `/workspace/...`), use an `init` method instead.
 */
import { defineCore, node } from '@astrale-os/kernel-dsl'

import { Note, AstraleDomainSchema } from './schema/schema.ts'

const welcome = node(Note, {
  'Named.name': 'welcome',
  title: 'Welcome',
  body: 'This note was seeded by `core.ts`. Edit it freely.',
})

export const AstraleDomainCore = defineCore(AstraleDomainSchema, {
  nodes: { welcome },
  edges: [],
})
