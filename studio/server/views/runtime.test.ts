import { afterEach, expect, test } from 'bun:test'

import type { ViewInfo } from '../../shared/types'

import { clearViewPreparations, readViewPreparation } from './preparation'
import { getViewRuntime } from './runtime'

afterEach(clearViewPreparations)

test('prepares one exact instance snapshot for the launch request', async () => {
  const view = { slug: 'issues', kind: 'unknown' } satisfies ViewInfo
  let activeReads = 0

  const runtime = await getViewRuntime('/workspace', 'issues.example.dev', view, {
    activeInstance: async () => {
      activeReads++
      return 'staging'
    },
  })

  expect(runtime).toEqual({
    slug: 'issues',
    preparationId: expect.stringMatching(/^[0-9a-f]{24}$/),
    instance: 'staging',
  })
  expect(activeReads).toBe(1)
  expect(
    readViewPreparation(runtime.preparationId, {
      root: '/workspace',
      origin: 'issues.example.dev',
      slug: 'issues',
    }),
  ).toMatchObject({ instance: 'staging' })
})
