import type { Node } from '@astrale-os/sdk/graph/node'

import { ClassPath } from '@astrale-os/sdk/graph/class'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { describe, expect, test } from 'bun:test'

import { displayName, listProjection } from '../ls'

describe('ls display projection', () => {
  const node = {
    id: NodeId('note-1'),
    class: ClassPath.parse('/:notes.example.dev:class.Note'),
    props: normalizeProperties({ 'notes.example.dev:class.Note.property.title': 'Hello' }),
  } satisfies Node

  /** @evidence TEST-CLI-LS-PROJECTS-CANONICAL-NODES */
  test('uses canonical properties for display and @id for pipeable output', () => {
    expect(displayName(node)).toBe('Hello')
    expect(listProjection([node])).toMatchObject({
      rows: [{ name: 'Hello', class: 'Note', id: 'note-1' }],
      paths: ['@note-1'],
    })
  })

  test('falls back to the canonical Node ID when no display property exists', () => {
    expect(displayName({ ...node, props: normalizeProperties({}) })).toBe('@note-1')
  })
})
