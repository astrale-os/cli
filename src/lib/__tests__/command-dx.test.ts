import { expect, test } from 'bun:test'
import { CommanderError } from 'commander'
import { stripVTControlCharacters } from 'node:util'

import { buildProgram } from '../../program/index'
import { renderCommanderError } from '../command-dx'

const excess = () =>
  new CommanderError(
    1,
    'commander.excessArguments',
    'error: too many arguments. Expected 0 arguments but got 2.',
  )
const conflicting = () =>
  new CommanderError(
    2,
    'commander.conflictingOption',
    'error: -i/--instance cannot be used with --admin\n-i/--instance selects an instance; --admin selects the Admin kernel.',
  )

test.each([
  {
    name: 'explains a shared verb as namespaced commands, not an arity error',
    error: excess,
    argv: ['delete', 'demo-system'],
    message: 'Unknown command: astrale delete demo-system',
    shown: [
      '"delete" is available under:',
      'astrale identity delete <name>',
      'astrale instance delete <id>',
    ],
    hidden: ['too many arguments'],
  },
  {
    name: 'suggests the nearest command for a typo',
    error: excess,
    argv: ['indetityl', 'ist'],
    message: 'Unknown command: astrale indetityl ist',
    shown: ['Did you mean:', 'astrale identity list'],
    hidden: [],
  },
  {
    name: 'prints a conflicting-option refusal with its command usage, never suggestions',
    error: conflicting,
    argv: ['call', '/:x', '--admin', '-i', 'staging'],
    message: 'error: -i/--instance cannot be used with --admin',
    shown: ['--admin selects the Admin kernel.', 'Usage:\n  astrale call <path> [params...]'],
    hidden: ['Did you mean:'],
  },
])('$name', async ({ error, argv, message, shown, hidden }) => {
  const program = await buildProgram()
  // Chalk colors only a color-capable stdout: strip so the suite reads the same in CI.
  const rendered = JSON.parse(
    stripVTControlCharacters(renderCommanderError(program, error(), [...argv], true)),
  )
  expect(rendered.error).toBe('USAGE_ERROR')
  expect(rendered.message).toContain(message)
  for (const text of shown) expect(rendered.detail).toContain(text)
  for (const text of hidden) expect(rendered.detail).not.toContain(text)
})
