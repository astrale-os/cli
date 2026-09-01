import { expect, test } from 'bun:test'

import {
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
    members: [{ origin, name: 'Identity', definition: 'class' }],
    ownerDomainIds: ['issues'],
  }
}

test('places new external clusters beside their owners without overlapping each other', () => {
  const result = projectExternalFrames(
    [cluster('alpha.astrale.ai'), cluster('kernel.astrale.ai')],
    [owner],
    {},
  )

  expect(result.positions['alpha.astrale.ai']).toEqual({
    x: owner.size.width + WORKSPACE_DOMAIN_GAP,
    y: 0,
  })
  expect(result.positions['kernel.astrale.ai']).toEqual({
    x: owner.size.width + WORKSPACE_DOMAIN_GAP,
    y: 152,
  })
})

test('reuses a saved external position when its owner frame moves', () => {
  const saved = { 'kernel.astrale.ai': { x: 512, y: 24 } }
  const result = projectExternalFrames(
    [cluster('kernel.astrale.ai')],
    [{ ...owner, position: { x: 1800, y: 700 } }],
    saved,
  )

  expect(result.positions).toEqual(saved)
})

test('an external frame moves like a domain frame, as one block', () => {
  const { nodes } = projectExternalFrames([cluster('kernel.astrale.ai')], [owner], {})
  const frame = nodes.find((node) => node.id === workspaceExternalNodeId('kernel.astrale.ai'))!
  const member = nodes.find((node) => node.parentId === frame.id)!

  expect(frame.draggable).toBe(true)
  // a place, not a thing you open — the same contract a domain frame carries
  expect(frame.selectable).toBe(false)
  // the block is ONE drag surface: a member rides along instead of swallowing the press
  expect(member.draggable).toBe(false)
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
