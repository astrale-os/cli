import { describe, expect, test } from 'bun:test'
import { CommanderError } from 'commander'

import { buildProgram } from '../../program'
import { collectCommandCatalog, renderCommanderError } from '../command-dx'

// `renderCommanderError` styles commands with `chalk.bold`, which emits ANSI
// codes only when chalk detects a color-capable stdout (TTY). Strip them so the
// assertions are deterministic whether the suite runs under a TTY or in CI.
// (Built from a char code so the regex source carries no literal control char.)
const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '')

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
    expect(usages).toContain('ls [path]')
    expect(usages).toContain('status')
  })

  test('explains shared verbs as namespaced commands, not arity errors', async () => {
    const program = await buildProgram()
    const error = new CommanderError(
      1,
      'commander.excessArguments',
      'error: too many arguments. Expected 0 arguments but got 2.',
    )
    const rendered = stripAnsi(renderCommanderError(program, error, ['delete', 'demo-system']))

    expect(rendered).toContain('Unknown command: astrale delete demo-system')
    expect(rendered).toContain('"delete" is available under:')
    expect(rendered).toContain('astrale identity delete <name>')
    expect(rendered).toContain('astrale instance delete <id>')
    expect(rendered).not.toContain('too many arguments')
  })

  test('suggests nearest command for typo paths', async () => {
    const program = await buildProgram()
    const error = new CommanderError(
      1,
      'commander.excessArguments',
      'error: too many arguments. Expected 0 arguments but got 2.',
    )
    const rendered = stripAnsi(renderCommanderError(program, error, ['indetityl', 'ist']))

    expect(rendered).toContain('Unknown command: astrale indetityl ist')
    expect(rendered).toContain('Did you mean:')
    expect(rendered).toContain('astrale identity list')
  })
})
