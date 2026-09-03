import { afterEach, expect, test } from 'bun:test'

import type { ViewInfo, ViewTargetResult } from '../../shared/types'

import { clearViewPreparations, readViewPreparation } from './preparation'
import { getViewRuntime } from './runtime'

afterEach(clearViewPreparations)

test('prepares one exact instance and target snapshot for the launch request', async () => {
  const view = {
    slug: 'issue-detail',
    kind: 'unknown',
    viewFor: 'Issue',
  } satisfies ViewInfo
  const targets: ViewTargetResult = {
    status: 'available',
    items: [
      {
        id: 'issue-1',
        ref: '@issue-1',
        className: 'Issue',
        classOrigin: 'issues.example.dev',
        label: 'First issue',
      },
    ],
    selected: null,
    stale: null,
    truncated: false,
  }
  let activeReads = 0
  let targetReads = 0

  const runtime = await getViewRuntime('/workspace', 'issues.example.dev', view, null, 8000, {
    activeInstance: async () => {
      activeReads++
      return 'staging'
    },
    listTargets: async () => {
      targetReads++
      return targets
    },
  })

  expect(runtime).toMatchObject({
    slug: 'issue-detail',
    instance: 'staging',
    targetRequired: true,
    targets,
  })
  expect(runtime.preparationId).toMatch(/^[0-9a-f]{24}$/)
  expect(activeReads).toBe(1)
  expect(targetReads).toBe(1)
  expect(
    readViewPreparation(runtime.preparationId, {
      root: '/workspace',
      origin: 'issues.example.dev',
      slug: 'issue-detail',
    }),
  ).toMatchObject({ instance: 'staging', targets })
})
