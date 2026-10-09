import type { InstalledRelease, InstallRequest, InstallResult } from '@astrale-os/sdk/client/schema'
import type { Command } from 'commander'

import { defineSchema } from '@astrale-os/sdk/schema'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { CommanderError } from 'commander'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import type { ServedDeployment } from '../../lib/domain-release'

import { deploymentReleaseFor } from '../../__tests__/fixtures/publication'
import { connectAdminRegistry } from '../../admin/registry'
import {
  digestOf,
  fakeAdmin,
  publication,
  REVISION,
  type FakeDomain,
  type FakePublication,
  type FakeRelease,
} from '../../admin/registry/__tests__/fake-admin'
import { callCommand } from '../../commands/call'
import { installByReference } from '../../commands/domain/release-install'
import { buildProgram } from '../index'

/**
 * The deploy, install, publish and rotation flow the shipped skills teach runs as written. Every
 * `astrale` command in a shell block of a skill parses against the real command tree, each action
 * replaced by a fake that records it. Then every `astrale domain install` example of the release
 * flow runs through the real install path against a fake Admin registry and a fake instance
 * Kernel, and the rotation example runs through `astrale call` against a fake Kernel lifecycle.
 */

const cliRoot = join(import.meta.dir, '../../..')
const skillsRoot = join(cliRoot, 'skills')

/** The files of the release flow, whose install examples must each run against the fakes. */
const RELEASE_FLOW = [
  'astrale-domain/references/release.md',
  'astrale-domain/references/development.md',
  'astrale-domain/references/migration.md',
  'astrale-cli/SKILL.md',
  'astrale-services/references/workflows.md',
] as const

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
  ID: 'deployment-1',
  DEPLOYMENT_ID: 'deployment-1',
  SERVICE_NODE_ID: 'service-1',
  TARGET: 'staging',
  CONSUMER_INSTANCE: 'consumer',
  CURSOR: 'cursor-1',
  TOKEN: 'token-1',
  ASTRALE_ISSUES_PROJECT_ID: 'project-1',
}

let fakeUrls: Readonly<Record<string, string>> = {}

/** The fake a `<placeholder>` of the examples stands for. */
function placeholder(name: string): string {
  if (fakeUrls[`<${name}>`] !== undefined) return fakeUrls[`<${name}>`]!
  if (name === 'command') return 'status'
  if (name === 'uuid') return '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
  if (name === 'session-id') return 'session-1'
  if (name.endsWith('url')) return 'https://placeholder.example'
  return `${name}-1`
}

function variable(name: string): string {
  return fakeUrls[`$${name}`] ?? VARIABLES[name] ?? `${name.toLowerCase()}-value`
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

interface Parsed {
  readonly command: string
  readonly args: readonly unknown[]
}

async function fakeProgram(): Promise<{ program: Command; seen: Parsed[] }> {
  const program = await buildProgram()
  const seen: Parsed[] = []
  const visit = (command: Command, path: readonly string[]) => {
    command.exitOverride()
    command.configureOutput({ writeOut: () => {}, writeErr: () => {} })
    command.action((...args: unknown[]) => {
      seen.push({ command: path.join(' '), args: args.slice(0, -1) })
    })
    for (const child of command.commands) visit(child, [...path, child.name()])
  }
  visit(program, [])
  return { program, seen }
}

/** Parse one example; undefined when it reached a command, else the parse refusal. */
async function parse(example: Example): Promise<{ parsed?: Parsed; refusal?: string }> {
  const { program, seen } = await fakeProgram()
  try {
    await program.parseAsync(['node', 'astrale', ...example.argv.slice(1)])
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error
    if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') return {}
    return { refusal: `${error.code}: ${error.message}` }
  }
  return seen.length === 1 ? { parsed: seen[0]! } : { refusal: `reached ${seen.length} actions` }
}

describe('skill examples parse against the command tree', () => {
  test('every astrale command in a skill shell block is a valid command line', async () => {
    const all = examples()
    expect(all.length).toBeGreaterThan(50)
    const refused: string[] = []
    for (const example of all) {
      const { refusal } = await parse(example)
      if (refusal !== undefined) {
        refused.push(`${example.file}:${example.line} ${example.source}\n  ${refusal}`)
      }
    }
    expect(refused).toEqual([])
  })

  test('no example passes --direct, and none puts a secret value in argv', () => {
    for (const example of examples()) {
      expect(example.argv, `${example.file}:${example.line}`).not.toContain('--direct')
      if (example.argv.some((word) => word.endsWith('.method.setSecret'))) {
        // The value comes from a file (-d @file) or from piped stdin (-d -, or no --data at all).
        const flag = example.argv.findIndex((word) => word === '-d' || word === '--data')
        const data = flag === -1 ? '-' : example.argv[flag + 1]
        expect(data === '-' || data?.startsWith('@'), `${example.file}:${example.line}`).toBe(true)
        expect(example.argv.some((word) => word.startsWith('value='))).toBe(false)
      }
    }
  })
})

// ── Install examples against a fake registry and a fake Kernel ──────────────

const GENERATED = '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
const ROUTING = 'svc.example.test'
const INSTALLER = 'operator'

/** An immutable deployment address (CT16): `<line>-<content>.<routing domain>`. */
const url = (line: string, content: string) =>
  `https://${line.repeat(16)}-${content.repeat(16)}.${ROUTING}`

/** What a Publication names of a deployment; Admin keeps no bundle, and no example reads one. */
function deployment(
  name: string,
  address: string,
): Pick<FakeRelease, 'url' | 'releaseDigest' | 'buildDigest'> {
  return {
    url: address,
    releaseDigest: digestOf(new TextEncoder().encode(`release:${name}`)),
    buildDigest: digestOf(new TextEncoder().encode(`build:${name}`)),
  }
}

/** Every deployment the examples name, by the origin it serves. */
const D = {
  issuesDevPrevious: { origin: 'issues.example', ...deployment('issues-dev-1', url('d', 'a')) },
  issuesDevNext: { origin: 'issues.example', ...deployment('issues-dev-2', url('d', 'b')) },
  issues142: { origin: 'issues.example', ...deployment('issues-1.4.2', url('p', 'k')) },
  issues150: { origin: 'issues.example', ...deployment('issues-1.5.0', url('p', 'm')) },
  issues151: { origin: 'issues.example', ...deployment('issues-1.5.1', url('p', 'n')) },
  issues152: { origin: 'issues.example', ...deployment('issues-1.5.2', url('p', 'o')) },
  agenciesStgPrevious: {
    origin: 'agencies.example',
    ...deployment('agencies-stg-1', url('s', 'a')),
  },
  agenciesStgNext: { origin: 'agencies.example', ...deployment('agencies-stg-2', url('s', 'b')) },
  employeesStgPrevious: {
    origin: 'employees.example',
    ...deployment('employees-stg-1', url('t', 'a')),
  },
  employeesStgNext: {
    origin: 'employees.example',
    ...deployment('employees-stg-2', url('t', 'b')),
  },
  agencies142: { origin: 'agencies.example', ...deployment('agencies-1.4.2', url('q', 'k')) },
  agencies150: { origin: 'agencies.example', ...deployment('agencies-1.5.0', url('q', 'm')) },
  employees152: { origin: 'employees.example', ...deployment('employees-1.5.2', url('r', 'k')) },
  employees200: { origin: 'employees.example', ...deployment('employees-2.0.0', url('r', 'm')) },
  a200: { origin: 'a.example', ...deployment('a-2.0.0', url('e', 'k')) },
  a210: { origin: 'a.example', ...deployment('a-2.1.0', url('e', 'm')) },
  b200: { origin: 'b.example', ...deployment('b-2.0.0', url('f', 'k')) },
  b300: { origin: 'b.example', ...deployment('b-3.0.0', url('f', 'm')) },
  crm150: { origin: 'crm.example', ...deployment('crm-1.5.0', url('g', 'k')) },
  crmStgPrevious: { origin: 'crm.example', ...deployment('crm-stg-1', url('c', 'a')) },
  crmStgNext: { origin: 'crm.example', ...deployment('crm-stg-2', url('c', 'b')) },
  crmOther: { origin: 'crm.example', ...deployment('crm-other', url('g', 'b')) },
  crmUrl: { origin: 'crm.example', ...deployment('crm-url', 'https://crm.example') },
  agenciesUrl: {
    origin: 'agencies.example',
    ...deployment('agencies-url', 'https://agencies.example'),
  },
  employeesUrl: {
    origin: 'employees.example',
    ...deployment('employees-url', 'https://employees.example'),
  },
  published: {
    origin: 'published.example.test',
    ...deployment('published', 'https://published.example.test'),
  },
} as const
type Deployment = (typeof D)[keyof typeof D]

const PLACEHOLDER_URLS = {
  '<url>': D.issuesDevNext.url,
  '<new-deployment-url>': D.crmStgNext.url,
  '<deployment-url>': D.crmOther.url,
  $URL_A: D.agenciesStgNext.url,
  $URL_B: D.employeesStgNext.url,
  $PUBLISHED_APPLICATION_URL: D.published.url,
} as const

function registryDomain(
  origin: string,
  versions: readonly (readonly [string, Deployment])[],
): FakeDomain {
  const publications: FakePublication[] = versions.map(([version, source], index) =>
    publication(
      `${origin}-${index}`,
      version,
      source,
      version === '1.5.2' ? { yankedAt: '2026-10-04T11:00:00.000Z' } : {},
    ),
  )
  return {
    id: `domain-${origin}`,
    origin,
    admins: new Set(['publisher']),
    installers: new Set([INSTALLER]),
    publications,
  }
}

const REGISTRY: FakeDomain[] = [
  registryDomain('issues.example', [
    ['1.4.2', D.issues142],
    ['1.5.0', D.issues150],
    ['1.5.1', D.issues151],
    ['1.5.2', D.issues152],
  ]),
  registryDomain('agencies.example', [
    ['1.4.2', D.agencies142],
    ['1.5.0', D.agencies150],
  ]),
  registryDomain('employees.example', [
    ['1.5.2', D.employees152],
    ['2.0.0', D.employees200],
  ]),
  registryDomain('a.example', [
    ['2.0.0', D.a200],
    ['2.1.0', D.a210],
  ]),
  registryDomain('b.example', [
    ['2.0.0', D.b200],
    ['3.0.0', D.b300],
  ]),
  registryDomain('crm.example', [['1.5.0', D.crm150]]),
]

function served(source: Deployment): ServedDeployment {
  return {
    origin: source.origin,
    issuer: source.url,
    revision: REVISION,
    release: deploymentReleaseFor(
      defineSchema(source.origin, { name: 'Skill fixture' }),
      source.url,
      source.buildDigest,
    ).document,
    pin: { kind: 'release', release: source.releaseDigest, build: source.buildDigest },
  }
}

function installedFrom(source: Deployment): InstalledRelease {
  return {
    origin: source.origin,
    revision: REVISION,
    issuer: source.url,
    url: new URL(source.url).origin,
    pin: { kind: 'release', release: source.releaseDigest, build: source.buildDigest },
    inFlight: [],
  } as unknown as InstalledRelease
}

/**
 * What each install example of the release flow runs against: the instance's installations before
 * it (none for a first install) and the release each root must end on. An example missing here, or
 * an entry no example uses, fails the test, so the table and the skills move together.
 */
const INSTALLS: Readonly<
  Record<
    string,
    {
      readonly before: readonly Deployment[]
      readonly after: readonly Deployment[]
      readonly consent?: 'same' | 'cross'
    }
  >
> = {
  // release.md
  'astrale domain install <url> -i acme-dev': { before: [], after: [D.issuesDevNext] },
  'astrale domain install "$URL_A" "$URL_B" --allow-issuer-change -i acme-stg': {
    before: [D.agenciesStgPrevious, D.employeesStgPrevious],
    after: [D.agenciesStgNext, D.employeesStgNext],
    consent: 'same',
  },
  'astrale domain install issues.example@1.5 -i acme-prod': { before: [], after: [D.issues151] },
  'astrale domain install issues.example@1.5.0 --allow-issuer-change -i acme-prod': {
    before: [D.issues142],
    after: [D.issues150],
    consent: 'same',
  },
  'astrale domain install agencies.example@1.5.0 employees.example@2.0.0 --allow-issuer-change -i acme-prod':
    {
      before: [D.agencies142, D.employees152],
      after: [D.agencies150, D.employees200],
      consent: 'same',
    },
  'astrale domain install issues.example@1.4.2 --allow-issuer-change -i acme-prod': {
    before: [D.issues150],
    after: [D.issues142],
    consent: 'same',
  },
  // development.md
  'astrale domain install <url> --allow-issuer-change -i <dev-instance>': {
    before: [D.issuesDevPrevious],
    after: [D.issuesDevNext],
    consent: 'same',
  },
  // migration.md
  'astrale domain install "$URL_A" "$URL_B" --allow-issuer-change -i staging': {
    before: [D.agenciesStgPrevious, D.employeesStgPrevious],
    after: [D.agenciesStgNext, D.employeesStgNext],
    consent: 'same',
  },
  'astrale domain install a.example@2.1.0 b.example@3.0.0 --allow-issuer-change -i production': {
    before: [D.a200, D.b200],
    after: [D.a210, D.b300],
    consent: 'same',
  },
  // astrale-cli/SKILL.md
  'astrale domain install https://crm.example -i staging': { before: [], after: [D.crmUrl] },
  'astrale domain install https://agencies.example https://employees.example -i staging': {
    before: [],
    after: [D.agenciesUrl, D.employeesUrl],
  },
  'astrale domain install crm.example@1.5 -i production': { before: [], after: [D.crm150] },
  'astrale domain install agencies.example@1.5.0 https://employees.example --allow-issuer-change -i staging':
    {
      before: [],
      after: [D.agencies150, D.employeesUrl],
    },
  'astrale domain install <new-deployment-url> --allow-issuer-change -i staging': {
    before: [D.crmStgPrevious],
    after: [D.crmStgNext],
    consent: 'same',
  },
  'astrale domain install <deployment-url> --allow-issuer-change=crm.example -i staging': {
    before: [D.crmStgPrevious],
    after: [D.crmOther],
    consent: 'cross',
  },
  // astrale-services/references/workflows.md
  'astrale domain install "$PUBLISHED_APPLICATION_URL" -i "$CONSUMER_INSTANCE"': {
    before: [],
    after: [D.published],
  },
}

class ExitError extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`)
  }
}

let stdout = ''
let stderr = ''
let originalExit: typeof process.exit
let originalStdout: typeof process.stdout.write
let originalStderr: typeof process.stderr.write

beforeEach(() => {
  stdout = ''
  stderr = ''
  fakeUrls = PLACEHOLDER_URLS
  originalExit = process.exit
  originalStdout = process.stdout.write.bind(process.stdout)
  originalStderr = process.stderr.write.bind(process.stderr)
  process.exit = ((code?: number | string | null) => {
    throw new ExitError(code)
  }) as typeof process.exit
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    return true
  }) as typeof process.stderr.write
})

afterEach(() => {
  fakeUrls = {}
  process.exit = originalExit
  process.stdout.write = originalStdout
  process.stderr.write = originalStderr
})

/** Run one install example's parsed references and options on a fake instance Kernel. */
async function runInstall(
  references: readonly string[],
  opts: Record<string, unknown>,
  before: readonly Deployment[],
) {
  const admin = fakeAdmin({ caller: INSTALLER, domains: REGISTRY })
  const deployments = new Map(Object.values(D).map((entry) => [entry.url, entry] as const))
  const requests: InstallRequest[] = []
  let installed = before.map(installedFrom)
  const session = {
    schema: {
      installed: async () => installed,
      install: async (request: InstallRequest) => {
        requests.push(request)
        const roots = request.domains.map((domain) => {
          const target = (domain as unknown as { release: { url: string } }).release.url
          return deployments.get(target)!
        })
        const origins = new Set<string>(roots.map((root) => root.origin))
        installed = [
          ...installed.filter((entry) => !origins.has(entry.origin)),
          ...roots.map(installedFrom),
        ]
        return {
          changed: true,
          receipt: {
            operation: GENERATED,
            transitions: roots.map((root, index) => ({
              intent: {
                transition: `transition-${index}`,
                operation: GENERATED,
                origin: root.origin,
                previous: null,
                generation: {
                  origin: root.origin,
                  revision: REVISION,
                  generation: `sha256:${'e'.repeat(64)}`,
                },
              },
              phase: 'cutover',
              state: 'committed',
            })),
          },
        } as unknown as InstallResult
      },
      inspect: async (origin: string) => ({ origin, revision: REVISION }),
    },
  }
  let failure: unknown
  try {
    await installByReference(
      references as [string, ...string[]],
      { ...opts, json: true },
      {
        createOperationId: () => GENERATED,
        withClientSession: (async (_opts: unknown, action: (context: never) => Promise<unknown>) =>
          action({ session } as never)) as never,
        openRegistry: async (_opts, work) => work(connectAdminRegistry(admin.context)),
        readDeployment: async (address: string) => {
          const source = deployments.get(address)
          if (source === undefined) throw new Error(`no fake deployment at ${address}`)
          return served(source)
        },
        now: () => 0,
        sleep: async () => {},
      },
    )
  } catch (error) {
    if (!(error instanceof ExitError)) throw error
    failure = error
  }
  return { requests, failure }
}

describe('release-flow install examples run against a fake registry and Kernel', () => {
  const flow = () =>
    examples().filter(
      (example) =>
        (RELEASE_FLOW as readonly string[]).includes(example.file) &&
        example.argv[1] === 'domain' &&
        example.argv[2] === 'install',
    )

  test('the table covers exactly the install examples of the release flow', () => {
    const written = new Set(flow().map((example) => example.source))
    expect([...written].filter((source) => !(source in INSTALLS))).toEqual([])
    expect(Object.keys(INSTALLS).filter((source) => !written.has(source))).toEqual([])
  })

  test('each example installs every root it names, in one operation, onto the release it names', async () => {
    for (const example of flow()) {
      const scenario = INSTALLS[example.source]
      const parsed = (await parse(example)).parsed!
      expect(parsed.command, example.source).toBe('domain install')
      const [references, opts] = parsed.args as [string[], Record<string, unknown>]
      expect(scenario, example.source).toBeDefined()
      stdout = ''
      stderr = ''
      const { requests, failure } = await runInstall(references, opts, scenario.before)
      expect(failure, `${example.source}\n${stderr}`).toBeUndefined()
      expect(requests, example.source).toHaveLength(1)
      expect(
        requests[0]!.domains.map((domain) => (domain as unknown as { release: unknown }).release),
        example.source,
      ).toEqual(scenario.after.map((root) => ({ url: root.url, digest: root.releaseDigest })))
      const report = JSON.parse(stdout) as { references: { consent?: unknown }[] }
      expect(
        report.references.filter((entry) => entry.consent !== undefined).length,
        example.source,
      ).toBe(scenario.consent === undefined ? 0 : scenario.before.length)
    }
  })

  test('without the consent an example writes, the same install is refused before any send', async () => {
    for (const example of flow()) {
      const scenario = INSTALLS[example.source]
      if (scenario?.consent === undefined) continue
      const [references, opts] = (await parse(example)).parsed!.args as [
        string[],
        Record<string, unknown>,
      ]
      // A cross-line change is not covered by the bare flag; a same-line one needs at least that.
      const weaker = scenario.consent === 'cross' ? [''] : undefined
      stdout = ''
      stderr = ''
      const { requests, failure } = await runInstall(
        references,
        { ...opts, allowIssuerChange: weaker },
        scenario.before,
      )
      expect(failure, example.source).toBeInstanceOf(ExitError)
      expect(requests, example.source).toEqual([])
      expect(JSON.parse(stderr), example.source).toMatchObject({
        error: 'ISSUER_CHANGE_NOT_CONSENTED',
      })
    }
  })
})

// ── Secret rotation example against a fake Kernel lifecycle ─────────────────

describe('the rotation example runs against a fake Admin call', () => {
  test('setSecret goes to the Admin kernel with the value read from the file, never from argv', async () => {
    const rotation = examples().filter(
      (example) =>
        example.file === 'astrale-domain/references/release.md' &&
        example.argv.some((word) => word.endsWith('.method.setSecret')) &&
        example.argv.includes('@rotate.json'),
    )
    expect(rotation).toHaveLength(1)
    const [example] = rotation
    const parsed = (await parse(example!)).parsed!
    expect(parsed.command).toBe('call')
    const [path, params, opts] = parsed.args as [string, string[], Record<string, unknown>]
    expect(path).toBe(
      '@deployment-1::services.astrale.ai:class.CloudflareDeployment.method.setSecret',
    )

    const directory = mkdtempSync(join(tmpdir(), 'astrale-skill-rotation-'))
    try {
      const secret = { name: 'API_TOKEN', value: 'rotated-value-never-in-argv' }
      writeFileSync(join(directory, 'rotate.json'), JSON.stringify(secret), { mode: 0o600 })
      const seen: unknown[] = []
      await callCommand(
        path,
        params,
        { ...opts, data: `@${join(directory, 'rotate.json')}` } as never,
        {
          async runKernelCommand(input) {
            seen.push({ admin: input.admin, credential: input.credential })
            await input.fn({
              session: {
                dispatch: async (request: unknown) => {
                  seen.push(request)
                  return { kind: 'value', value: { name: secret.name } }
                },
              },
            } as never)
          },
          output() {},
        },
      )
      expect(seen[0]).toEqual({
        admin: {},
        credential: { principal: 'callable', path: expect.anything() },
      })
      expect(JSON.stringify(seen[1])).toContain(secret.value)
      expect(example!.argv.join(' ')).not.toContain(secret.value)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
