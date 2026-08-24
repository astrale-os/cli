import type { Command, CommanderError } from 'commander'

import chalk from 'chalk'

export type CommandCatalogEntry = {
  path: string[]
  usage: string
}

export function collectCommandCatalog(program: Command): CommandCatalogEntry[] {
  const out: CommandCatalogEntry[] = []

  function walk(command: Command, path: string[]): void {
    for (const child of command.commands) {
      const childPath = [...path, child.name()]
      if (child.commands.length === 0) {
        out.push({ path: childPath, usage: usageFor(childPath, child) })
      }
      walk(child, childPath)
    }
  }

  walk(program, [])
  return out
}

export function renderCommanderError(
  program: Command,
  error: CommanderError,
  argv = process.argv.slice(2),
  machine = argv.some((token) => token === '--ci' || token === '--json' || token === '--raw') ||
    !(process.stdout.isTTY ?? false),
): string {
  const tokens = stripOptions(argv)
  const catalog = collectCommandCatalog(program)
  const matched = matchRegisteredPrefix(program, tokens)

  if (matched.path.length === 0 && tokens.length > 0) {
    return maybeMachine(renderUnknownCommand(tokens, catalog), machine)
  }

  if (error.code === 'commander.missingArgument') {
    const usage = usageFor(matched.path, matched.command)
    return maybeMachine(
      [
        `Missing required argument for ${chalk.bold(`astrale ${matched.path.join(' ')}`)}`,
        '',
        'Usage:',
        `  astrale ${usage}`,
      ].join('\n'),
      machine,
    )
  }

  if (error.code === 'commander.excessArguments') {
    const usage = usageFor(matched.path, matched.command)
    const extra = tokens.slice(matched.path.length).join(' ')
    return maybeMachine(
      [
        `Unexpected argument${extra.includes(' ') ? 's' : ''} for ${chalk.bold(
          `astrale ${matched.path.join(' ')}`,
        )}${extra ? `: ${extra}` : ''}`,
        '',
        'Usage:',
        `  astrale ${usage}`,
      ].join('\n'),
      machine,
    )
  }

  const suggestions = nearestCommands(tokens.join(' '), catalog)
  return maybeMachine(
    [
      error.message,
      ...(suggestions.length > 0
        ? ['', 'Did you mean:', ...suggestions.map((s) => `  astrale ${s}`)]
        : []),
    ].join('\n'),
    machine,
  )
}

const RETIRED_COMMANDS: Record<string, string> = {
  ls: 'astrale query <source> --edge <class>',
  describe: 'astrale get <target>',
}

function renderUnknownCommand(tokens: string[], catalog: CommandCatalogEntry[]): string {
  const command = tokens.join(' ')
  const first = tokens[0]
  const retired = first === undefined ? undefined : RETIRED_COMMANDS[first]
  if (retired !== undefined) {
    return [
      `Unknown command: ${chalk.bold(`astrale ${command}`)}`,
      '',
      `\`astrale ${first}\` was removed. Use ${chalk.bold(retired)} instead.`,
    ].join('\n')
  }
  const namespaceMatches = catalog.filter((entry) => entry.path.at(-1) === first)
  if (namespaceMatches.length > 0) {
    return [
      `Unknown command: ${chalk.bold(`astrale ${command}`)}`,
      '',
      `"${first}" is available under:`,
      ...namespaceMatches.map((entry) => `  astrale ${entry.usage}`),
    ].join('\n')
  }

  const suggestions = nearestCommands(command, catalog)
  return [
    `Unknown command: ${chalk.bold(`astrale ${command}`)}`,
    ...(suggestions.length > 0
      ? ['', 'Did you mean:', ...suggestions.map((s) => `  astrale ${s}`)]
      : []),
  ].join('\n')
}

function matchRegisteredPrefix(
  program: Command,
  tokens: string[],
): { command: Command; path: string[] } {
  let current = program
  const path: string[] = []
  for (const token of tokens) {
    const next = current.commands.find(
      (cmd) => cmd.name() === token || cmd.aliases().includes(token),
    )
    if (!next) break
    current = next
    path.push(current.name())
  }
  return { command: current, path }
}

function usageFor(path: string[], command: Command): string {
  const suffix = command
    .usage()
    .replace(/\[options\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return [path.join(' '), suffix].filter(Boolean).join(' ')
}

const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')

function maybeMachine(text: string, machine: boolean): string {
  if (!machine) return text
  const plain = text.replace(ANSI_RE, '')
  const first = plain.split('\n').find((line) => line.trim().length > 0) ?? plain
  return JSON.stringify({ error: 'USAGE_ERROR', message: first, detail: plain })
}

function stripOptions(argv: string[]): string[] {
  const out: string[] = []
  for (const token of argv) {
    if (token === '--') break
    if (token.startsWith('-')) continue
    out.push(token)
  }
  return out
}

function nearestCommands(input: string, catalog: CommandCatalogEntry[]): string[] {
  if (!input) return []
  return catalog
    .map((entry) => ({ usage: entry.usage, score: similarity(input, entry.path.join(' ')) }))
    .filter((entry) => entry.score >= 0.45)
    .sort((a, b) => b.score - a.score || a.usage.localeCompare(b.usage))
    .slice(0, 3)
    .map((entry) => entry.usage)
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  return 1 - levenshtein(a, b) / max
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const curr = Array.from({ length: b.length + 1 }, () => 0)
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev.splice(0, prev.length, ...curr)
  }
  return prev[b.length] ?? 0
}
