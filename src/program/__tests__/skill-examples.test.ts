import type { Command } from 'commander'

import { describe, expect, test } from 'bun:test'
import { CommanderError } from 'commander'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { buildProgram } from '../index'

/**
 * Every `astrale` command in a shell block of a shipped skill parses against the real command tree,
 * each action replaced by a fake that records it.
 */

const skillsRoot = join(import.meta.dir, '../../..', 'skills')

// ── Extraction ──────────────────────────────────────────────────────────────

interface Example {
  readonly file: string
  readonly line: number
  /** The command as written, continuations joined, without its trailing comment. */
  readonly source: string
  /** Its words once the fakes below replace variables, substitutions and placeholders. */
  readonly argv: readonly string[]
}

const SHELL_FENCES = new Set(['sh', 'bash', 'shell', 'console', ''])

function skillFiles(root: string): string[] {
  return readdirSync(root)
    .flatMap((name) => {
      const path = join(root, name)
      return statSync(path).isDirectory() ? skillFiles(path) : name.endsWith('.md') ? [path] : []
    })
    .sort()
}

/** Every shell line of every fenced block whose language is a shell, continuations joined. */
function shellLines(path: string): { readonly line: number; readonly text: string }[] {
  const lines = readFileSync(path, 'utf8').split('\n')
  const out: { line: number; text: string }[] = []
  let fence: string | undefined
  let pending: { line: number; text: string } | undefined
  lines.forEach((raw, index) => {
    const marker = /^\s*```(\S*)/.exec(raw)
    if (marker !== null) {
      fence = fence === undefined ? marker[1]! : undefined
      return
    }
    if (fence === undefined || !SHELL_FENCES.has(fence)) return
    const text = raw.replace(/^\s*\$ /, '')
    const continued = /\\\s*$/.test(text)
    const body = text.replace(/\\\s*$/, ' ')
    pending =
      pending === undefined
        ? { line: index + 1, text: body }
        : { ...pending, text: `${pending.text} ${body.trim()}` }
    if (!continued) {
      out.push({ line: pending.line, text: pending.text.trim() })
      pending = undefined
    }
  })
  return out
}

/** The fake each shell variable and command substitution of the examples expands to. */
const VARIABLES: Readonly<Record<string, string>> = {
  DEPLOYMENT_ID: 'deployment-1',
  SERVICE_NODE_ID: 'service-1',
  SERVICE_PATH: '@service-1',
  TARGET: 'staging',
  CONSUMER_INSTANCE: 'consumer',
  CURSOR: 'cursor-1',
  TOKEN: 'token-1',
  ASTRALE_ISSUES_PROJECT_ID: 'project-1',
}

/** The fake a `<placeholder>` of the examples stands for. */
function placeholder(name: string): string {
  if (name === 'command') return 'status'
  if (name === 'uuid') return '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
  if (name === 'session-id') return 'session-1'
  if (name.endsWith('url')) return 'https://placeholder.example'
  return `${name}-1`
}

function variable(name: string): string {
  return VARIABLES[name] ?? `${name.toLowerCase()}-value`
}

/**
 * The simple commands of one shell line, with variables and `$(...)` expanded to fakes: words are
 * split on blanks outside quotes, commands on `|`, `;` and `&&`, and `< file` redirections and `#`
 * comments are dropped. A command substitution contributes its own commands too.
 */
function commands(text: string): string[][] {
  const out: string[][] = []
  let current: string[] = []
  let word = ''
  let inWord = false
  const pushWord = () => {
    if (inWord)
      current.push(word.replace(/<([a-z0-9-]+)>/g, (_, name: string) => placeholder(name)))
    word = ''
    inWord = false
  }
  const endCommand = () => {
    pushWord()
    if (current.length > 0) out.push(current)
    current = []
  }
  const expand = (at: number): number => {
    if (text[at + 1] === '(') {
      let depth = 1
      let end = at + 2
      while (depth > 0) {
        if (text[end] === '(') depth += 1
        if (text[end] === ')') depth -= 1
        end += 1
      }
      out.push(...commands(text.slice(at + 2, end - 1)))
      word += 'substituted'
      inWord = true
      return end
    }
    const braced = text[at + 1] === '{'
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(at + (braced ? 2 : 1)))?.[0] ?? ''
    word += variable(name)
    inWord = true
    return at + (braced ? 3 : 1) + name.length
  }
  let index = 0
  while (index < text.length) {
    const char = text[index]!
    if (char === "'") {
      const end = text.indexOf("'", index + 1)
      word += text.slice(index + 1, end)
      inWord = true
      index = end + 1
    } else if (char === '"') {
      inWord = true
      index += 1
      while (text[index] !== '"') {
        if (text[index] === '\\') {
          word += text[index + 1]
          index += 2
        } else if (text[index] === '$') {
          index = expand(index)
        } else {
          word += text[index]
          index += 1
        }
      }
      index += 1
    } else if (char === '$') {
      index = expand(index)
    } else if (char === '#' && !inWord) {
      break
    } else if (char === ' ' || char === '\t') {
      pushWord()
      index += 1
    } else if (char === '|' || char === ';' || char === '&') {
      endCommand()
      index += text[index + 1] === char ? 2 : 1
    } else if ((char === '<' || char === '>') && !inWord && text[index + 1] === ' ') {
      pushWord()
      index += 2
      while (index < text.length && text[index] !== ' ') index += 1
    } else {
      word += char
      inWord = true
      index += 1
    }
  }
  endCommand()
  return out
}

/** The `astrale` commands of the skills; synopsis lines (`...`, `[optional]`) are not examples. */
function examples(): Example[] {
  return skillFiles(skillsRoot).flatMap((path) =>
    shellLines(path).flatMap(({ line, text }) => {
      if (/\.\.\.|\s\[[^\]]*\]/.test(text)) return []
      return commands(text)
        .map((words) => words.slice(words.findIndex((entry) => !/^[A-Z_]+=/.test(entry))))
        .filter((words) => words[0] === 'astrale')
        .map((argv) => ({
          file: relative(skillsRoot, path),
          line,
          source: text.replace(/\s+#\s.*$/, '').trim(),
          argv,
        }))
    }),
  )
}

// ── Command tree with fake actions ──────────────────────────────────────────

async function fakeProgram(): Promise<{ program: Command; seen: string[] }> {
  const program = await buildProgram()
  const seen: string[] = []
  const visit = (command: Command, path: readonly string[]) => {
    command.exitOverride()
    command.configureOutput({ writeOut: () => {}, writeErr: () => {} })
    command.action(() => void seen.push(path.join(' ')))
    for (const child of command.commands) visit(child, [...path, child.name()])
  }
  visit(program, [])
  return { program, seen }
}

/** Parse one example; undefined when it reached exactly one command, else the parse refusal. */
async function refusal(example: Example): Promise<string | undefined> {
  const { program, seen } = await fakeProgram()
  try {
    await program.parseAsync(['node', 'astrale', ...example.argv.slice(1)])
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error
    if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') return
    return `${error.code}: ${error.message}`
  }
  return seen.length === 1 ? undefined : `reached ${seen.length} actions`
}

describe('skill examples parse against the command tree', () => {
  /** @evidence TEST-CLI-PROGRAM-SKILL-EXAMPLES-PARSE */
  test('every astrale command in a skill shell block is a valid command line', async () => {
    const all = examples()
    expect(all.length).toBeGreaterThan(50)
    const refused: string[] = []
    for (const example of all) {
      const reason = await refusal(example)
      if (reason !== undefined)
        refused.push(`${example.file}:${example.line} ${example.source}\n  ${reason}`)
    }
    expect(refused).toEqual([])
  })

  test('no example passes --direct, and none puts a secret value in argv', () => {
    for (const example of examples()) {
      expect(example.argv, `${example.file}:${example.line}`).not.toContain('--direct')
      if (example.argv.some((word) => word.endsWith('.method.setSecret'))) {
        expect(
          example.argv.some((word) =>
            word.endsWith('::services.astrale.ai:class.CloudflareService.method.setSecret'),
          ),
          `${example.file}:${example.line}`,
        ).toBe(true)
        // The value comes from a file (-d @file) or from piped stdin (-d -, or no --data at all).
        const flag = example.argv.findIndex((word) => word === '-d' || word === '--data')
        const data = flag === -1 ? '-' : example.argv[flag + 1]
        expect(data === '-' || data?.startsWith('@'), `${example.file}:${example.line}`).toBe(true)
        expect(example.argv.some((word) => word.startsWith('value='))).toBe(false)
      }
    }
  })
})
