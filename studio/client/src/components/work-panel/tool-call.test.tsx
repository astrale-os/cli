import type { AgentToolCall } from '@shared/contracts/agent'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ToolCallView } from './tool-call'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const render = (call: Partial<AgentToolCall>) =>
  renderToStaticMarkup(
    <ToolCallView
      running={false}
      call={{ title: 'call', status: 'completed', content: [], locations: [], ...call }}
    />,
  )

test('an edit shows its file and changed lines once, and a file is listed only when nothing names it', () => {
  const edit = render({
    title: 'Edit schema/user.ts',
    kind: 'edit',
    content: [
      {
        type: 'diff',
        path: 'domains/crm/schema/user.ts',
        oldText: 'props: {\n  name: z.string(),\n}',
        newText: 'props: {\n  name: z.string(),\n  email: z.string(),\n}',
      },
    ],
    locations: ['domains/crm/schema/user.ts:12'],
  })
  expect(edit).toContain('title="domains/crm/schema/user.ts"')
  expect(text(edit)).toContain('email: z.string(),')
  expect(text(edit)).not.toContain('File ')

  const search = render({
    title: 'grep -n "email" schema',
    kind: 'search',
    input: { pattern: 'email', path: 'schema' },
    content: [{ type: 'text', text: 'schema/person.ts:4: email' }],
    locations: ['schema', 'schema/person.ts:4'],
  })
  expect(text(search)).toContain('File schema/person.ts:4')
  expect(search.match(/<li/g)).toHaveLength(1)
})

test('a raw result reads as its text, and a failure as its error', () => {
  const output = render({
    title: 'Load skill: agent-browser',
    input: { skill: 'agent-browser' },
    output: [{ type: 'text', text: 'Launching skill: agent-browser' }],
  })
  expect(text(output)).toContain('Output Launching skill: agent-browser')
  expect(output).not.toContain('&quot;type&quot;')

  const failed = render({
    title: 'ls',
    status: 'failed',
    input: { command: 'ls' },
    output: { formatted_output: 'ls: denied', exit_code: 1 },
  })
  expect(text(failed)).toContain('Error formatted_output ls: denied exit_code 1')
})
