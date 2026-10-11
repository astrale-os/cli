import { describe, expect, test } from 'bun:test'
import { CommanderError } from 'commander'

import { buildProgram } from '../../program/index'
import { renderCommanderError } from '../command-dx'

// `renderCommanderError` styles commands with `chalk.bold`, which emits ANSI
// codes only when chalk detects a color-capable stdout (TTY). Strip them so the
// assertions are deterministic whether the suite runs under a TTY or in CI.
// (Built from a char code so the regex source carries no literal control char.)
const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '')

function dx(
  program: Awaited<ReturnType<typeof buildProgram>>,
  error: CommanderError,
  argv: string[],
) {
  const rendered = JSON.parse(stripAnsi(renderCommanderError(program, error, argv, true))) as {
    error: string
    message: string
    detail: string
  }
  expect(rendered.error).toBe('USAGE_ERROR')
  return rendered
}

describe('command DX suggestions', () => {
  test('explains shared verbs as namespaced commands, not arity errors', async () => {
    const program = await buildProgram()
    const error = new CommanderError(
      1,
      'commander.excessArguments',
      'error: too many arguments. Expected 0 arguments but got 2.',
    )
    const rendered = dx(program, error, ['delete', 'demo-system'])

    expect(rendered.message).toContain('Unknown command: astrale delete demo-system')
    expect(rendered.detail).toContain('"delete" is available under:')
    expect(rendered.detail).toContain('astrale identity delete <name>')
    expect(rendered.detail).toContain('astrale instance delete <id>')
    expect(rendered.detail).not.toContain('too many arguments')
  })

  test('prints a conflicting-option refusal with its command usage, never suggestions', async () => {
    const program = await buildProgram()
    const error = new CommanderError(
      2,
      'commander.conflictingOption',
      'error: -i/--instance cannot be used with --admin\n-i/--instance selects an instance; --admin selects the Admin kernel.',
    )
    const rendered = dx(program, error, ['call', '/:x', '--admin', '-i', 'staging'])

    expect(rendered.message).toBe('error: -i/--instance cannot be used with --admin')
    expect(rendered.detail).toContain('--admin selects the Admin kernel.')
    expect(rendered.detail).toContain('Usage:\n  astrale call <path> [params...]')
    expect(rendered.detail).not.toContain('Did you mean:')
  })

  test('suggests nearest command for typo paths', async () => {
    const program = await buildProgram()
    const error = new CommanderError(
      1,
      'commander.excessArguments',
      'error: too many arguments. Expected 0 arguments but got 2.',
    )
    const rendered = dx(program, error, ['indetityl', 'ist'])

    expect(rendered.message).toContain('Unknown command: astrale indetityl ist')
    expect(rendered.detail).toContain('Did you mean:')
    expect(rendered.detail).toContain('astrale identity list')
  })
})
