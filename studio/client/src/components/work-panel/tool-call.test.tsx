import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ToolCallView } from './tool-call'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

test('a command reads as what it was given, then what came back', () => {
  const html = renderToStaticMarkup(
    <ToolCallView
      running={false}
      call={{
        title: 'pnpm test',
        kind: 'execute',
        status: 'completed',
        input: { command: 'pnpm test', description: 'Run the suite', timeout: 60_000 },
        content: [{ type: 'text', text: '```console\n12 pass\n```', truncated: true }],
        locations: [],
      }}
    />,
  )

  expect(text(html)).toContain('Input command pnpm test description Run the suite timeout 60000')
  // the output is the agent's markdown: its fence is a code block, not literal backticks
  expect(html).toContain('<pre')
  expect(html).toContain('12 pass')
  expect(html).not.toContain('```')
  expect(html).toContain('Too long to show whole')
})

test('an edit shows its file and the lines it changed', () => {
  const html = renderToStaticMarkup(
    <ToolCallView
      running={false}
      call={{
        title: 'Edit schema/user.ts',
        kind: 'edit',
        status: 'completed',
        content: [
          {
            type: 'diff',
            path: 'domains/crm/schema/user.ts',
            oldText: 'props: {\n  name: z.string(),\n}',
            newText: 'props: {\n  name: z.string(),\n  email: z.string(),\n}',
          },
        ],
        locations: ['domains/crm/schema/user.ts:12'],
      }}
    />,
  )

  // no input reported: the call's own words say what it was
  expect(text(html)).toContain('Edit schema/user.ts')
  expect(html).toContain('title="domains/crm/schema/user.ts"')
  expect(html.match(/bg-success\/10/g)).toHaveLength(1)
  expect(html).not.toContain('bg-destructive/10')
  // the diff already names the file: it is not listed a second time
  expect(text(html)).not.toContain('File ')
})

test('a file the call touched is listed only when nothing above names it', () => {
  const html = renderToStaticMarkup(
    <ToolCallView
      running={false}
      call={{
        title: 'grep -n "email" schema',
        kind: 'search',
        status: 'completed',
        input: { pattern: 'email', path: 'schema' },
        content: [{ type: 'text', text: 'schema/person.ts:4: email' }],
        locations: ['schema', 'schema/person.ts:4'],
      }}
    />,
  )

  expect(text(html)).toContain('File schema/person.ts:4')
  expect(html.match(/<li/g)).toHaveLength(1)
})

test('a failed call says so, and one still running says it is waiting', () => {
  const failed = renderToStaticMarkup(
    <ToolCallView
      running={false}
      call={{
        title: 'ls',
        status: 'failed',
        input: { command: 'ls' },
        content: [],
        output: { formatted_output: 'ls: denied', exit_code: 1 },
        locations: [],
      }}
    />,
  )
  expect(text(failed)).toContain('Error formatted_output ls: denied exit_code 1')

  const running = renderToStaticMarkup(
    <ToolCallView
      running
      call={{ title: 'ls', status: 'in_progress', input: 'ls', content: [], locations: [] }}
    />,
  )
  expect(text(running)).toContain('Waiting for the result…')
})

test('a raw result made of text blocks reads as its text, not as their JSON', () => {
  const html = renderToStaticMarkup(
    <ToolCallView
      running={false}
      call={{
        title: 'Load skill: agent-browser',
        kind: 'other',
        status: 'completed',
        input: { skill: 'agent-browser' },
        content: [],
        output: [{ type: 'text', text: 'Launching skill: agent-browser' }],
        locations: [],
      }}
    />,
  )

  expect(text(html)).toContain('Output Launching skill: agent-browser')
  expect(html).not.toContain('&quot;type&quot;')
})
