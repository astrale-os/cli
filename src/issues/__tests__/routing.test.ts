import type { Command } from 'commander'

import { describe, expect, it } from 'bun:test'

import { buildProgram } from '../../program'

async function reached(argv: readonly string[]): Promise<string[]> {
  const program = await buildProgram()
  const seen: string[] = []
  const visit = (command: Command, path: readonly string[]) => {
    command.exitOverride()
    command.configureOutput({ writeOut: () => {}, writeErr: () => {} })
    command.action(() => void seen.push(path.join(' ')))
    for (const child of command.commands) visit(child, [...path, child.name()])
  }
  visit(program, [])
  await program.parseAsync(['node', 'astrale', ...argv])
  return seen
}

describe('astrale issue routing', () => {
  it('keeps a bare title and --retry on report', async () => {
    expect(await reached(['issue', 'Title', '--body', 'Details'])).toEqual(['issue report'])
    expect(await reached(['issue', '--body', 'Details', 'Title'])).toEqual(['issue report'])
    expect(await reached(['issue', '--retry', '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'])).toEqual([
      'issue report',
    ])
  })

  it('routes the reporter follow-up commands', async () => {
    expect(await reached(['issue', 'list', '--all'])).toEqual(['issue list'])
    expect(await reached(['issue', 'show', 'ASTRALE-1'])).toEqual(['issue show'])
    expect(await reached(['issue', 'edit', 'ASTRALE-1', '--title', 'New'])).toEqual(['issue edit'])
    expect(await reached(['issue', 'archive', 'ASTRALE-1'])).toEqual(['issue archive'])
  })
})
