import type { Node } from '@xyflow/react'

import { expect, test } from 'bun:test'

import {
  externalFrameLayout,
  externalLanes,
  followExternalFrames,
  projectExternalFrames,
  workspaceExternalMemberNodeId,
  workspaceExternalNodeId,
  workspaceExternalOrigin,
  type WorkspaceExternalCluster,
} from './external-frames'
import { WORKSPACE_DOMAIN_GAP, type WorkspaceDomainFrame } from './geometry'

const owner: WorkspaceDomainFrame = {
  domainId: 'issues',
  position: { x: 0, y: 0 },
  size: { width: 400, height: 300 },
}

function cluster(origin: string): WorkspaceExternalCluster {
  return {
    origin,
    members: [{ origin, name: 'Identity', definition: 'class', connected: true }],
    ownerDomainIds: ['issues'],
  }
}

/** A footprint dependency nothing on the canvas points at. */
function inert(origin: string, name: string) {
  return { origin, name, definition: 'class' as const }
}

test('a new external frame lands beside its owner, and follows it until moved by hand', () => {
  const clusters = [cluster('alpha.astrale.ai'), cluster('kernel.astrale.ai')]
  const x = owner.size.width + WORKSPACE_DOMAIN_GAP
  expect(projectExternalFrames(clusters, [owner], {}).positions).toEqual({
    'alpha.astrale.ai': { x, y: 0 },
    'kernel.astrale.ai': { x, y: 152 },
  })

  const saved = { 'kernel.astrale.ai': { x: 900, y: 600 } }
  const moved = { ...owner, position: { x: 300, y: 400 } }
  expect(projectExternalFrames(clusters, [moved], saved).positions).toEqual({
    'alpha.astrale.ai': { x: x + 300, y: 400 },
    ...saved,
  })
})

test('an external frame moves like a domain frame, as one block', () => {
  const { nodes } = projectExternalFrames([cluster('kernel.astrale.ai')], [owner], {})
  const frame = nodes.find((node) => node.id === workspaceExternalNodeId('kernel.astrale.ai'))!
  const member = nodes.find((node) => node.parentId === frame.id)!

  expect(frame.draggable).toBe(true)
  // a place, not a thing you open — the same contract a domain frame carries
  expect(frame.selectable).toBe(false)
  // a member rides with its frame, but remains an inspectable selection target
  expect(member.draggable).toBe(false)
  expect(member.selectable).toBe(true)
  expect(member.style?.pointerEvents).toBe('none')
})

test('reads an origin back off a frame id and off nothing else', () => {
  expect(workspaceExternalOrigin(workspaceExternalNodeId('kernel.astrale.ai'))).toBe(
    'kernel.astrale.ai',
  )
  expect(
    workspaceExternalOrigin(
      workspaceExternalMemberNodeId('kernel.astrale.ai', 'Identity', 'class'),
    ),
  ).toBeNull()
  expect(workspaceExternalOrigin('workspace-domain:issues')).toBeNull()
})

test('a folded frame cards what is wired and counts the rest; unfolded it lists them', () => {
  const members = [
    {
      origin: 'kernel.astrale.ai',
      name: 'Identity',
      definition: 'class' as const,
      connected: true,
    },
    inert('kernel.astrale.ai', 'Account'),
    inert('kernel.astrale.ai', 'Session'),
  ]
  const folded = externalFrameLayout({ ...cluster('kernel.astrale.ai'), members })
  expect(folded.placements.map(({ member }) => member.name)).toEqual(['Identity'])
  expect(folded).toMatchObject({ connectedCount: 1, inertCount: 2 })

  const unfolded = externalFrameLayout({ ...cluster('kernel.astrale.ai'), members, expanded: true })
  expect(unfolded.placements.map(({ member }) => member.name)).toEqual([
    'Identity',
    'Account',
    'Session',
  ])
  // a listed dependency is half the height of a card, so unfolding a big kernel stays legible
  expect(unfolded.placements.map(({ height }) => height)).toEqual([52, 26, 26])
})

test('a domain keeps room on its right only for the imported frames that follow it', () => {
  const clusters = [
    cluster('alpha.astrale.ai'),
    { ...cluster('kernel.astrale.ai'), ownerDomainIds: ['billing'] },
  ]

  expect(externalLanes(clusters, { 'kernel.astrale.ai': { x: 0, y: 0 } })).toEqual({
    issues: 216 + WORKSPACE_DOMAIN_GAP,
  })
})

test('a dropped domain repaints the imported frames that follow it, and nothing else', () => {
  const frame = (id: string, x: number, y: number, type = 'extDomain'): Node => ({
    id,
    type,
    position: { x, y },
    data: {},
  })
  const current = [frame('domain', 0, 0, 'workspaceDomain'), frame('alpha', 10, 10)]
  const projected = [frame('domain', 50, 50, 'workspaceDomain'), frame('alpha', 60, 60)]

  const next = followExternalFrames(current, projected)

  expect(next[0]).toBe(current[0])
  expect(next[1]!.position).toEqual({ x: 60, y: 60 })
  expect(followExternalFrames(next, projected)).toBe(next)
})
