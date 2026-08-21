import { describe, expect, test } from 'bun:test'

import type { RememberedViewTarget, ViewTargetCandidate } from '../../shared/types'

import { reconcileRememberedTarget, targetFromRow } from './model'

describe('target candidates', () => {
  const remembered: RememberedViewTarget = {
    id: 'gone-id',
    className: 'Issue',
    classOrigin: 'issues.astrale.ai',
    label: 'Deleted issue',
  }
  const candidate: ViewTargetCandidate = {
    id: 'live-id',
    ref: '@live-id',
    className: 'Issue',
    classOrigin: 'issues.astrale.ai',
    label: 'Live issue',
  }

  test('turns a missing remembered node into an explicit stale selection', () => {
    expect(reconcileRememberedTarget(remembered, [candidate])).toEqual({
      selected: null,
      stale: remembered,
    })
    expect(reconcileRememberedTarget({ ...remembered, id: 'live-id' }, [candidate])).toEqual({
      selected: candidate,
      stale: null,
    })
  })

  test('builds friendly candidates from generic qualified node properties', () => {
    expect(
      targetFromRow(
        {
          id: 'iss-1',
          props: {
            'kernel.astrale.ai:interface.Named.property.name': 'Broken authorization badge',
            'kernel.astrale.ai:interface.Descriptable.property.description': 'Studio regression',
            'kernel.astrale.ai:interface.Statused.property.status': 'open',
          },
        },
        'Issue',
        'issues.astrale.ai',
      ),
    ).toEqual({
      id: 'iss-1',
      ref: '@iss-1',
      className: 'Issue',
      classOrigin: 'issues.astrale.ai',
      label: 'Broken authorization badge',
      description: 'Studio regression',
      status: 'open',
    })
  })
})
