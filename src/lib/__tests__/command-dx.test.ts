import { describe, expect, test } from 'bun:test'
import { CommanderError } from 'commander'

import { buildProgram } from '../../program/index'
import { collectCommandCatalog, renderCommanderError } from '../command-dx'

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
  test('collects command paths from the registered program tree', async () => {
    const program = await buildProgram()
    const usages = collectCommandCatalog(program).map((entry) => entry.usage)

    expect(usages).toContain('identity use <name>')
    expect(usages).toContain('instance use [name]')
    expect(usages).toContain('admin status')
    expect(usages).toContain('admin use [bookmark]')
    expect(usages).toContain('use <name>')
    expect(usages).toContain('update')
    expect(usages).toContain('query [sources...]')
    expect(usages).toContain('get <target>')
    expect(usages).toContain('introspect <target>')
    expect(usages).toContain('status')
    expect(usages).not.toContain('ls <source>')
    expect(usages).not.toContain('describe <target>')
  })

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

  test('points retired describe at get', async () => {
    const program = await buildProgram()
    const error = new CommanderError(
      1,
      'commander.unknownCommand',
      "error: unknown command 'describe'",
    )
    const rendered = dx(program, error, ['describe', '@note'])

    expect(rendered.message).toContain('Unknown command: astrale describe @note')
    expect(rendered.detail).toContain('astrale describe` was removed')
    expect(rendered.detail).toContain('astrale get <target>')
    expect(rendered.detail).not.toContain('Did you mean:')
  })

  test('points retired ls at query', async () => {
    const program = await buildProgram()
    const error = new CommanderError(1, 'commander.unknownCommand', "error: unknown command 'ls'")
    const rendered = dx(program, error, ['ls', '@note'])

    expect(rendered.message).toContain('Unknown command: astrale ls @note')
    expect(rendered.detail).toContain('astrale ls` was removed')
    expect(rendered.detail).toContain('astrale query <source> --edge <class>')
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
