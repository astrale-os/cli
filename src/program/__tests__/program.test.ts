import type { Command } from 'commander'

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildProgram, normalizeRootVersionArgv } from '../index'

// Help output is the public CLI contract: version, spec anchors, and skill mirror stay in sync.

const cliRoot = join(import.meta.dir, '../../..')

/** Every command in the tree (root + groups + nested subgroups), depth-first. */
function allCommands(cmd: Command): Command[] {
  return [cmd, ...cmd.commands.flatMap(allCommands)]
}

describe('help contract — version is single-sourced', () => {
  /** @evidence TEST-CLI-PROGRAM-VERSION-SINGLE-SOURCE */
  test('program version === package.json === release-please manifest', async () => {
    const program = await buildProgram()
    const pkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8')) as {
      version: string
    }
    const manifest = JSON.parse(
      readFileSync(join(cliRoot, '.release-please-manifest.json'), 'utf8'),
    ) as Record<string, string>

    // Program version must follow both package.json and release-please metadata.
    expect(program.version()).toBe(pkg.version)
    expect(manifest['.']).toBe(pkg.version)
  })
})

type InspectedCommand = Command & {
  readonly _allowExcessArguments?: boolean
  readonly _allowUnknownOption?: boolean
  readonly _combineFlagAndOptionalValue?: boolean
  readonly _enablePositionalOptions?: boolean
  readonly _hidden?: boolean
  readonly _passThroughOptions?: boolean
  readonly _showHelpAfterError?: boolean
  readonly _showSuggestionAfterError?: boolean
  readonly _storeOptionsAsProperties?: boolean
}

type InspectedArgument = Command['registeredArguments'][number] & {
  readonly parseArg?: unknown
}

type InspectedOption = Command['options'][number] & {
  readonly conflictsWith?: readonly string[]
  readonly implied?: Readonly<Record<string, unknown>>
}

function ledgeredSurface(root: Command): readonly object[] {
  const rows: object[] = []
  const visit = (command: Command, parents: readonly string[]): void => {
    const inspected = command as InspectedCommand
    rows.push({
      command: parents.join(' '),
      aliases: command.aliases(),
      description: command.description(),
      summary: command.summary(),
      arguments: command.registeredArguments.map((argument) => {
        const inspectedArgument = argument as InspectedArgument
        return {
          name: argument.name(),
          description: argument.description,
          required: Boolean(argument.required),
          variadic: Boolean(argument.variadic),
          defaultValue: argument.defaultValue ?? null,
          choices: argument.argChoices ?? null,
          hasParser: typeof inspectedArgument.parseArg === 'function',
        }
      }),
      options: command.options.map((option) => {
        const inspectedOption = option as InspectedOption
        return {
          flags: option.flags,
          attribute: option.attributeName(),
          description: option.description,
          required: Boolean(option.required),
          optional: Boolean(option.optional),
          variadic: Boolean(option.variadic),
          mandatory: Boolean(option.mandatory),
          negate: Boolean(option.negate),
          hidden: Boolean(option.hidden),
          defaultValue: option.defaultValue ?? null,
          presetArg: option.presetArg ?? null,
          envVar: option.envVar ?? null,
          choices: option.argChoices ?? null,
          conflictsWith: inspectedOption.conflictsWith ?? [],
          implied: inspectedOption.implied ?? null,
          hasParser: typeof option.parseArg === 'function',
        }
      }),
      behavior: {
        allowExcessArguments: Boolean(inspected._allowExcessArguments),
        allowUnknownOption: Boolean(inspected._allowUnknownOption),
        combineFlagAndOptionalValue: Boolean(inspected._combineFlagAndOptionalValue),
        enablePositionalOptions: Boolean(inspected._enablePositionalOptions),
        passThroughOptions: Boolean(inspected._passThroughOptions),
        showHelpAfterError: Boolean(inspected._showHelpAfterError),
        showSuggestionAfterError: Boolean(inspected._showSuggestionAfterError),
        storeOptionsAsProperties: Boolean(inspected._storeOptionsAsProperties),
      },
      hidden: Boolean(inspected._hidden),
      help: command.helpInformation(),
    })
    for (const child of command.commands) visit(child, [...parents, child.name()])
  }
  visit(root, [])
  return rows.sort((left, right) => {
    const leftName = (left as { command: string }).command
    const rightName = (right as { command: string }).command
    return leftName.localeCompare(rightName)
  })
}

describe('program composition', () => {
  /** @evidence TEST-CLI-PROGRAM-MATCHES-LEDGERED-SURFACE */
  test('matches the complete ledgered command and help surface', async () => {
    const surface = ledgeredSurface(await buildProgram())
    const paths = surface.map((entry) => (entry as { command: string }).command)

    expect(paths).toEqual([
      '',
      '__view-serve',
      'admin',
      'admin status',
      'admin use',
      'auth',
      'auth login',
      'auth logout',
      'auth status',
      'auth token',
      'browser',
      'call',
      'domain',
      'domain install',
      'domain list',
      'domain publish',
      'domain uninstall',
      'get',
      'identity',
      'identity create',
      'identity delete',
      'identity export',
      'identity import',
      'identity list',
      'identity register',
      'identity sync',
      'identity unsync',
      'identity use',
      'identity whoami',
      'idp',
      'idp add',
      'idp list',
      'idp refresh',
      'idp remove',
      'idp show',
      'instance',
      'instance active',
      'instance bookmark',
      'instance create',
      'instance delete',
      'instance forget',
      'instance invitation',
      'instance invitation reconcile',
      'instance invitation status',
      'instance invite',
      'instance list',
      'instance root',
      'instance root import',
      'instance status',
      'instance use',
      'introspect',
      'logs',
      'mutate',
      'query',
      'session',
      'session analyze',
      'session list',
      'setup',
      'skills',
      'skills configure',
      'skills status',
      'skills update',
      'status',
      'studio',
      'token',
      'ui',
      'ui add',
      'ui doctor',
      'ui init',
      'ui preset',
      'ui preset apply',
      'ui preset list',
      'ui request',
      'ui search',
      'update',
      'use',
      'view',
      'whoami',
    ])
  })

  /** @evidence TEST-CLI-PROGRAM-BUILDS-ISOLATED-ROOTS */
  test('builds a fresh Commander root for each consumer', async () => {
    const first = await buildProgram()
    first.command('__temporary-test-command')

    const second = await buildProgram()
    expect(second).not.toBe(first)
    expect(second.commands.some((command) => command.name() === '__temporary-test-command')).toBe(
      false,
    )
  })
})

describe('help contract — no internal SPEC anchors leak to users', () => {
  test('no rendered --help text contains a § section anchor', async () => {
    const program = await buildProgram()
    const offenders = allCommands(program)
      .filter((c) => c.helpInformation().includes('§'))
      .map((c) => c.name() || '<root>')

    expect(offenders).toEqual([])
  })

  test('Kernel and Instance vocabulary does not expose retired Host or Interface concepts', async () => {
    const program = await buildProgram()
    const help = allCommands(program)
      .map((command) => command.helpInformation())
      .join('\n')

    expect(help).not.toContain('host.astrale.ai')
    expect(help).not.toContain(':interface.')
    expect(help).not.toContain('Class or Interface')
    expect(help).not.toContain('emulated host')
    expect(help).not.toContain('Host shell')
  })
})

describe('help contract — IdP/auth surface is registered', () => {
  test('idp group and auth commands are visible in --help tree', async () => {
    const program = await buildProgram()
    const names = allCommands(program).map((command) => command.name())

    expect(names).toContain('idp')
    expect(names).toContain('add')
    expect(names).toContain('login')
    expect(names).toContain('token')
    expect(names).toContain('update')
    expect(program.helpInformation()).toContain('idp')
    expect(program.helpInformation()).toContain('update')
  })

  test('identity registration names its existing-local-identity prerequisite', async () => {
    const program = await buildProgram()
    const identityRegister = program.commands
      .find((command) => command.name() === 'identity')
      ?.commands.find((command) => command.name() === 'register')
    let help = ''
    identityRegister?.configureOutput({
      writeOut: (chunk) => {
        help += chunk ?? ''
      },
    })
    identityRegister?.outputHelp()

    expect(identityRegister?.description()).toBe(
      'Register a local key identity on an existing Identity Node',
    )
    expect(help).toContain('Existing local identity name')
    expect(help).toContain('astrale identity create alice')
    expect(help).toContain('Register never creates or replaces the')
    expect(help).not.toContain('Atomically provision a local key identity')
    expect(help).toContain('--node <nodePath>')
    expect(help).not.toContain('--class')
    expect(help).not.toContain('--props')
  })
})

describe('help contract — admin target surface is registered', () => {
  test('admin group and admin-target flags are visible', async () => {
    const program = await buildProgram()
    const names = allCommands(program).map((command) => command.name())
    const instanceCreate = allCommands(program).find((command) => command.name() === 'create')

    expect(names).toContain('admin')
    expect(names).toContain('status')
    expect(names).toContain('use')
    expect(program.helpInformation()).toContain('admin')
    expect(instanceCreate?.helpInformation()).toContain('--admin <name>')
    expect(instanceCreate?.helpInformation()).toContain('--admin-url <url>')

    const adminUse = program.commands
      .find((command) => command.name() === 'admin')
      ?.commands.find((command) => command.name() === 'use')
    expect(adminUse?.helpInformation()).toContain('--kernel-issuer <url>')
    expect(adminUse?.helpInformation()).toContain('--domain-issuer <url>')
    expect(adminUse?.helpInformation()).not.toContain('--issuer <url>')
  })

  test('public instance commands expose no Kernel operator target', async () => {
    const program = await buildProgram()
    const instanceCreate = allCommands(program).find((command) => command.name() === 'create')
    const help = instanceCreate?.helpInformation() ?? ''

    expect(help).toContain('Provision an instance through Admin')
    expect(help).not.toContain('--host')
    expect(help).not.toContain('Kernel Host')
    const root = program.commands
      .find((command) => command.name() === 'instance')
      ?.commands.find((command) => command.name() === 'root')
      ?.commands.find((command) => command.name() === 'import')
    expect(root?.helpInformation()).not.toContain('--host')
    expect(help).not.toContain('Fleet')
    expect(help).not.toContain('--host-id')
    expect(help).not.toContain('--no-use')
    expect(help).not.toContain('Instance.init')
  })

  test('retired Instances extend the ordinary administrator inventory', async () => {
    const program = await buildProgram()
    const instanceList = program.commands
      .find((command) => command.name() === 'instance')
      ?.commands.find((command) => command.name() === 'list')
    const help = instanceList?.helpInformation() ?? ''

    expect(help).toContain('--include-retired')
    expect(help).toContain('--admin <name>')
    expect(help).not.toContain('--lifecycle')
  })
})

describe('help contract — connect-only command surface', () => {
  test('runtime management commands are not registered', async () => {
    const program = await buildProgram()
    const names = program.commands.map((command) => command.name())

    // `logs` and `domain` have managed/admin meanings, so only retired verbs are absent.
    for (const removed of [
      'init',
      'start',
      'stop',
      'restart',
      'reset',
      'bootstrap',
      'tunnel',
      'graph',
      'server',
      'env',
      'ls',
      'describe',
    ]) {
      expect(names).not.toContain(removed)
    }
  })
})

describe('help contract — UI is project tooling', () => {
  test('add recovery guidance uses only registered UI commands', async () => {
    const program = await buildProgram()
    const uiAdd = program.commands
      .find((command) => command.name() === 'ui')
      ?.commands.find((command) => command.name() === 'add')
    let help = ''
    uiAdd?.configureOutput({
      writeOut: (chunk) => {
        help += chunk ?? ''
      },
    })
    uiAdd?.outputHelp()

    expect(help).toContain('astrale ui doctor')
    expect(help).toContain('--overwrite --yes')
    expect(help).not.toMatch(/\b(?:astrale ui )?diff\b/u)
  })

  test('keeps the documented root version alias operational', async () => {
    const program = await buildProgram()
    let stdout = ''
    program.exitOverride().configureOutput({
      writeOut: (chunk) => {
        stdout += chunk ?? ''
      },
    })

    await expect(
      program.parseAsync(normalizeRootVersionArgv(['node', 'astrale', '--version'])),
    ).rejects.toMatchObject({ code: 'commander.version' })
    expect(stdout.trim()).toBe(program.version() ?? '')
    expect(program.helpInformation()).toMatch(/root alias:\s+--version/u)
  })

  test('routes the root version alias without rewriting UI search arguments', async () => {
    const program = await buildProgram()
    const uiSearch = program.commands
      .find((command) => command.name() === 'ui')
      ?.commands.find((command) => command.name() === 'search')
    let observedQuery: unknown
    uiSearch?.action((query) => {
      observedQuery = query
    })

    const uiArgv = ['node', 'astrale', 'ui', 'search', 'chart', '--limit', '5']
    expect(normalizeRootVersionArgv(uiArgv)).toEqual(uiArgv)
    expect(normalizeRootVersionArgv(['node', 'astrale', '--version'])).toEqual([
      'node',
      'astrale',
      '--cli-version',
    ])
    expect(normalizeRootVersionArgv(['node', 'astrale', '--ci', '--version'])).toEqual([
      'node',
      'astrale',
      '--ci',
      '--cli-version',
    ])

    await program.parseAsync(uiArgv)

    expect(observedQuery).toBe('chart')
  })

  test('routes explicit versions with positional inputs for UI init and update', async () => {
    const program = await buildProgram()
    const uiInit = program.commands
      .find((command) => command.name() === 'ui')
      ?.commands.find((command) => command.name() === 'init')
    const update = program.commands.find((command) => command.name() === 'update')
    let initializedPath: unknown
    let initializedVersion: unknown
    let updateVersion: unknown
    uiInit?.action((projectPath, options) => {
      initializedPath = projectPath
      initializedVersion = options.version
    })
    update?.action((options) => {
      updateVersion = options.version
    })

    await program.parseAsync([
      'node',
      'astrale',
      'ui',
      'init',
      './app',
      '--version',
      '0.3.0-beta.1',
    ])
    expect(initializedPath).toBe('./app')
    expect(initializedVersion).toBe('0.3.0-beta.1')

    await program.parseAsync(['node', 'astrale', 'update', '--version', '1.0.0-beta.13'])
    expect(updateVersion).toBe('1.0.0-beta.13')
  })

  test('continues to admit global machine flags after a subcommand', async () => {
    const program = await buildProgram()
    const uiSearch = program.commands
      .find((command) => command.name() === 'ui')
      ?.commands.find((command) => command.name() === 'search')
    let invoked = false
    uiSearch?.action(() => {
      invoked = true
    })

    await program.parseAsync(['node', 'astrale', 'ui', 'search', 'chart', '--ci', '--no-prompt'])

    expect(invoked).toBe(true)
  })

  test('only UI request connects to a Kernel and add accepts canonical addresses', async () => {
    const program = await buildProgram()
    const ui = program.commands.find((command) => command.name() === 'ui')
    const add = ui?.commands.find((command) => command.name() === 'add')

    expect(ui?.commands.map((command) => command.name())).toEqual([
      'init',
      'search',
      'request',
      'add',
      'doctor',
      'preset',
    ])
    expect(add?.helpInformation()).toContain('[items...]')
    for (const command of ui?.commands.filter((candidate) => candidate.name() !== 'request') ??
      []) {
      const help = command.helpInformation()
      expect(help).not.toContain('--url <url>')
      expect(help).not.toContain('--anonymous')
    }
    const request = ui?.commands.find((command) => command.name() === 'request')
    expect(request?.helpInformation()).toContain('--url <url>')
    expect(request?.helpInformation()).toContain('--anonymous')
  })
})

describe('help contract — read command split', () => {
  test('get is point-read only and query owns structured read flags', async () => {
    const program = await buildProgram()
    const get = allCommands(program).find((command) => command.name() === 'get')
    const query = allCommands(program).find((command) => command.name() === 'query')
    const getHelp = get?.helpInformation() ?? ''
    const queryHelp = query?.helpInformation() ?? ''

    expect(getHelp).toContain('Usage: astrale get [options] <target>')
    expect(getHelp).not.toContain('-l, --long')
    expect(getHelp).not.toContain('--depth')
    expect(getHelp).not.toContain('--children')
    expect(getHelp).not.toContain('--edges')
    expect(getHelp).not.toContain('--graph')

    expect(queryHelp).toContain('Usage: astrale query [options] [sources...]')
    expect(queryHelp).not.toContain('--depth <n>')
    expect(queryHelp).not.toContain('--children <json>')
    expect(queryHelp).not.toContain('--edges <json>')
    expect(queryHelp).toContain('--ast <json>')
    expect(queryHelp).toContain('--class <path>')
    expect(queryHelp).not.toContain('--definition')
    expect(queryHelp).toContain('--edge <class>')
    expect(queryHelp).toContain('--direction <direction>')
    expect(queryHelp).toContain('--limit <n>')
    expect(queryHelp).toContain('--cursor <token>')
    expect(queryHelp).not.toContain('--cypher <query>')
  })

  test('keeps the removed query --definition flag outside the parsed command surface', async () => {
    const program = await buildProgram()
    const query = allCommands(program).find((command) => command.name() === 'query')
    const parsed = query?.parseOptions(['--definition', '/:notes.example.dev:class.Note'])

    expect(parsed?.unknown).toContain('--definition')
    expect(query?.options.some((option) => option.attributeName() === 'definition')).toBe(false)
  })

  test('routes query --class through Commander as the exact Class option', async () => {
    const program = await buildProgram()
    const query = allCommands(program).find((command) => command.name() === 'query')
    let observed: unknown
    query?.action((sources, options) => {
      observed = { sources, class: options.class, limit: options.limit, json: options.json }
    })

    await program.parseAsync([
      'node',
      'astrale',
      'query',
      '--class',
      '/:notes.example.dev:class.Note',
      '--limit',
      '1',
      '--json',
    ])

    expect(observed).toEqual({
      sources: [],
      class: '/:notes.example.dev:class.Note',
      limit: '1',
      json: true,
    })
  })
})

describe('help contract — explicit anonymous authentication', () => {
  test('kernel commands expose the credential-less session flag', async () => {
    const program = await buildProgram()
    const call = allCommands(program).find((command) => command.name() === 'call')

    expect(call?.helpInformation()).toContain('--anonymous')
    expect(call?.helpInformation()).toContain('Send no credential')
  })
})

describe('help contract — payload sources', () => {
  test('call excludes --file while mutate supports it', async () => {
    const program = await buildProgram()
    const call = allCommands(program).find((command) => command.name() === 'call')
    const mutate = allCommands(program).find((command) => command.name() === 'mutate')
    const callHelp = call?.helpInformation() ?? ''
    const mutateHelp = mutate?.helpInformation() ?? ''

    expect(callHelp).toContain('--data <json>')
    expect(callHelp).not.toContain('--file <path>')
    expect(callHelp).not.toContain('--describe')
    expect(mutateHelp).toContain('--data <json>')
    expect(mutateHelp).toContain('--file <path>')
  })
})

describe('help contract — skill is single-source, not duplicated', () => {
  const canonical = join(cliRoot, 'skills/astrale-cli/SKILL.md')
  // Workspace mirror lives in the superrepo, outside this submodule. Absent
  // when the CLI repo is tested standalone — only assert parity when present.
  const mirror = join(cliRoot, '../.agents/skills/astrale-cli/SKILL.md')

  test('canonical skill file exists and is non-empty', () => {
    expect(existsSync(canonical)).toBe(true)
    expect(readFileSync(canonical, 'utf8').length).toBeGreaterThan(0)
  })

  test.skipIf(!existsSync(mirror))(
    'workspace mirror is byte-identical to the canonical skill',
    () => {
      expect(readFileSync(mirror, 'utf8')).toBe(readFileSync(canonical, 'utf8'))
    },
  )
})
