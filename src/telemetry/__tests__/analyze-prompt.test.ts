import { expect, test } from 'bun:test'

import { buildPrompt } from '../analyze'

test('DX filing uses the Project receiver and current machine-mode call shape', () => {
  const prompt = buildPrompt({
    id: 'session-42',
    root: '/workspace',
    signals: {
      eventCount: 0,
      failures: [],
      retries: [],
      harnessSessions: [],
    },
    guides: new Map(),
    file: true,
  })

  expect(prompt).toContain(
    '"@$ASTRALE_ISSUES_PROJECT_ID::issues.astrale.ai:class.Project.method.createIssue"',
  )
  expect(prompt).toContain('astrale --ci --no-prompt call')
  expect(prompt).toContain('"description"')
  expect(prompt).toContain('"priority":2')
  expect(prompt).toContain('Issue Node ID and reference')
  expect(prompt).not.toContain('class.Issue:create')
  expect(prompt).not.toContain('initialTags')
})
