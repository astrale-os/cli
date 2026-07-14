import { expect, test } from 'bun:test'

import { projectExternalFrames, type WorkspaceExternalCluster } from './external-frames'
import { WORKSPACE_DOMAIN_GAP, type WorkspaceDomainFrame } from './geometry'

const owner: WorkspaceDomainFrame = {
  domainId: 'issues',
  position: { x: 0, y: 0 },
  size: { width: 400, height: 300 },
  contentOffset: { x: 52, y: 100 },
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
