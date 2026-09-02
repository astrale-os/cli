import type { Edge } from '@xyflow/react'

import { expect, test } from 'bun:test'

import { relationshipEdgeIds, selectedRelationshipContext } from './structure'

const memberEdges: Edge[] = [
  {
    id: 'edge-member-a',
    source: 'class.Team',
    target: 'class.Alice',
    data: { edgeClass: 'Member', ownerDomainId: 'crm' },
  },
  {
    id: 'edge-member-b',
    source: 'class.Team',
    target: 'class.Bob',
    data: { edgeClass: 'Member', ownerDomainId: 'crm' },
  },
  {
    id: 'edge-member-elsewhere',
    source: 'class.Squad',
    target: 'class.Carol',
    data: { edgeClass: 'Member', ownerDomainId: 'ops' },
  },
  {
    id: 'edge-owns',
    source: 'class.Team',
    target: 'class.Asset',
    data: { edgeClass: 'Owns', ownerDomainId: 'crm' },
  },
]

test('a clicked physical edge promotes exactly its own two endpoints', () => {
  const context = selectedRelationshipContext(['edge-member-b'], memberEdges)
  expect([...context!.edgeIds]).toEqual(['edge-member-b'])
  expect([...context!.nodeIds]).toEqual(['class.Team', 'class.Bob'])
  expect(selectedRelationshipContext(['missing'], memberEdges)).toBeNull()
  expect(selectedRelationshipContext([], memberEdges)).toBeNull()
})

test('a relationship NAMED rather than clicked lights every path it is drawn as', () => {
  // ⌘K, the rail and a comment anchor all hand over a class name, never a physical line —
  // so all of that relationship's paths light up, and only inside the domain declaring it.
  const ids = relationshipEdgeIds(memberEdges, 'crm', 'Member')
  expect(ids).toEqual(['edge-member-a', 'edge-member-b'])

  const context = selectedRelationshipContext(ids, memberEdges)
  expect([...context!.nodeIds]).toEqual(['class.Team', 'class.Alice', 'class.Bob'])
  // a node class shares the `class.` namespace but names no line — nothing to light
  expect(relationshipEdgeIds(memberEdges, 'crm', 'Team')).toEqual([])
})
