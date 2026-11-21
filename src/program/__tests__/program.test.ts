import type { Command } from 'commander'

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_TIMEOUT_MS, DEFAULT_WAIT_MS } from '../../connection/timeouts'
import { buildProgram, normalizeRootVersionArgv } from '../index'

const cliRoot = join(import.meta.dir, '../../..')

function find(program: Command, path: string): Command {
  return path
    .split(' ')
    .reduce((command, name) => command.commands.find((child) => child.name() === name)!, program)
}

/** @evidence TEST-CLI-PROGRAM-VERSION-SINGLE-SOURCE */
test('the program version is the package and release-please version', async () => {
  const pkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8')) as {
    version: string
  }
  const manifest = JSON.parse(
    readFileSync(join(cliRoot, '.release-please-manifest.json'), 'utf8'),
  ) as Record<string, string>
  expect((await buildProgram()).version()).toBe(pkg.version)
  expect(manifest['.']).toBe(pkg.version)
})

test('root --version prints the CLI version while subcommands keep their own --version', async () => {
  const program = await buildProgram()
  let stdout = ''
  program.exitOverride().configureOutput({ writeOut: (chunk) => void (stdout += chunk) })
  await expect(
    program.parseAsync(normalizeRootVersionArgv(['node', 'astrale', '--ci', '--version'])),
  ).rejects.toMatchObject({ code: 'commander.version' })
  expect(stdout.trim()).toBe(program.version() ?? '')

  const seen: unknown[] = []
  find(program, 'ui init').action((path, options) => void seen.push(path, options.version))
  find(program, 'update').action((options) => void seen.push(options.version))
  for (const argv of [
    ['node', 'astrale', 'ui', 'init', './app', '--version', '0.3.0-beta.1', '--ci', '--no-prompt'],
    ['node', 'astrale', 'update', '--version', '1.0.0-beta.13'],
  ]) {
    await program.parseAsync(normalizeRootVersionArgv(argv))
  }
  expect(seen).toEqual(['./app', '0.3.0-beta.1', '1.0.0-beta.13'])
})

/** @evidence TEST-CLI-PROGRAM-BUILDS-ISOLATED-ROOTS */
test('builds a fresh Commander root for each consumer', async () => {
  const first = await buildProgram()
  first.command('__temporary-test-command')
  const second = await buildProgram()
  expect(second.commands.some((command) => command.name() === '__temporary-test-command')).toBe(
    false,
  )
})

test('--timeout says what it bounds: the request, and the wait of a command that waits', async () => {
  const program = await buildProgram()
  const timeout = (path: string) => {
    const options = find(program, path).options.filter((option) => option.long === '--timeout')
    expect(options).toHaveLength(1)
    return options[0]!.description
  }
  for (const path of ['domain install', 'domain uninstall', 'call', 'execution result'])
    expect(timeout(path)).toBe(
      `Request timeout in ms (default: ${DEFAULT_TIMEOUT_MS}); while waiting for the outcome, it bounds the request and the wait together (default wait: ${DEFAULT_WAIT_MS})`,
    )
  for (const path of ['query', 'execution status', 'domain list'])
    expect(timeout(path)).toBe(`Request timeout in ms (default: ${DEFAULT_TIMEOUT_MS})`)
})
