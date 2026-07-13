import { describe, expect, test } from 'bun:test'

import type { RememberedViewTarget, ViewTargetCandidate } from '../../shared/types'

import {
  conciseCliFailure,
  localViewUrl,
  reconcileRememberedTarget,
  targetFromRow,
  targetQuery,
} from './views'

describe('managed local view URLs', () => {
  test('mounts each view beneath the Studio-assigned server origin', () => {
    expect(localViewUrl('http://127.0.0.1:5173', '/ui/issues')).toBe(
      'http://127.0.0.1:5173/ui/issues',
    )
    expect(localViewUrl('http://127.0.0.1:61001/ignored', 'ui/issue')).toBe(
      'http://127.0.0.1:61001/ui/issue',
    )
  })
})

test('reduces CLI stack output to the actionable kernel failure', () => {
  expect(
    conciseCliFailure(
      `275 |   if (code === KERNEL_ERROR_CODES.INVALID_REQUEST)\n276 |\nPermissionDeniedError: Permission denied: READ on /:issues.astrale.ai:view.issue\n details: {\n  method: \"View:resolve\"\n}\n at mapServerError (errors.ts:280:61)\nBun v1.3.14`,
    ),
  ).toBe('PermissionDeniedError: Permission denied: READ on /:issues.astrale.ai:view.issue')
})

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

  test('queries exact class instances through instance_of', () => {
    const query = targetQuery('Issue', 'issues.astrale.ai')
    expect(query).toContain('(n:Node)-[:instance_of]->(c:Class)-[:of_domain]->(d:Domain)')
    expect(query).toContain('"Issue"')
    expect(query).toContain('"issues.astrale.ai"')
    expect(query).toContain('LIMIT 201')
  })
})
