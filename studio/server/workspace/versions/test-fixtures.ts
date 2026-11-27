/**
 * Test support for the Workspace level: on-disk projects with a package, a Project definition and
 * a linked (never executed) `astrale-domain`, admitted bundles, and a context whose CLI, process
 * runner and island are scripted. No test reaches the network or starts a platform command.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SchemaRevision, StudioSchemaBundle } from '../../../shared/contracts/schema'
import type { PublicationSummary } from '../../../shared/contracts/versions'
import type { DomainHandle } from '../../domain/registry'
import type { CapturedProcess, ChildOptions } from '../../process'
import type { VersionsContext } from './context'
import type { IslandRequest } from './island'

const roots: string[] = []

/** A distinct, well-formed Schema revision. */
export function revision(seed: string): SchemaRevision {
  const hex = Buffer.from(seed).toString('hex').padEnd(64, '0').slice(0, 64)
  return `sha256:${hex}`
}

export function project(options: {
  id: string
  version?: string
  /** The `environments` literal of `defineProject`; omitted declares none. */
  environments?: string
  sdk?: string | null
  tooling?: boolean
}): DomainHandle {
  const root = mkdtempSync(join(tmpdir(), 'studio-versions-'))
  roots.push(root)
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: `@test/${options.id}`, version: options.version ?? '1.0.0' }),
  )
  const environments =
    options.environments === undefined ? '' : `, environments: ${options.environments}`
  writeFileSync(
    join(root, 'astrale.config.ts'),
    `import { cloudflare } from '@astrale-os/adapter-cloudflare'
import { defineProject } from '@astrale-os/sdk/project'
import domain from './domain.js'
export default defineProject({ domain${environments} })
`,
  )
  if (options.sdk !== null) {
    mkdirSync(join(root, 'node_modules', '@astrale-os', 'sdk'), { recursive: true })
    writeFileSync(
      join(root, 'node_modules', '@astrale-os', 'sdk', 'package.json'),
      JSON.stringify({ name: '@astrale-os/sdk', version: options.sdk ?? '0.6.0-beta.62' }),
    )
  }
  if (options.tooling !== false) {
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true })
    const bin = join(root, 'node_modules', '.bin', 'astrale-domain')
    writeFileSync(bin, '#!/bin/sh\nexit 97\n')
    chmodSync(bin, 0o755)
  }
  return {
    id: options.id,
    root,
    configFile: join(root, 'astrale.config.ts'),
    domainFile: join(root, 'domain.ts'),
    schemaDirName: 'schema',
    schemaDir: join(root, 'schema'),
    schemaIndex: join(root, 'schema', 'index.ts'),
  }
}

export function disposeProjects(): void {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
}

export function admittedBundle(
  id: string,
  origin: string,
  schemaRevision: SchemaRevision,
  dependencies: Record<string, { origin: string; revision: SchemaRevision }> = {},
): StudioSchemaBundle {
  return {
    domainId: id,
    renderFingerprint: `sha-${id}`,
    schemaMode: 'canonical-admitted',
    schemaRevision,
    extractedBy: 'runtime-bun',
    depsInstalled: true,
    ir: { domain: origin } as StudioSchemaBundle['ir'],
    schemaRoot: { format: 'astrale.dsl', version: 'v1', origin, dependencies },
    schemaClosure: [],
    overlay: { handlerLinks: [], definitions: [], integrations: [], sourceSpans: {} },
    error: null,
    extractedAt: '2026-11-26T00:00:00.000Z',
  }
}

export function publication(
  version: string,
  schemaRevision: SchemaRevision,
  extra: Partial<PublicationSummary> = {},
): PublicationSummary {
  return {
    version,
    url: `https://${version}.example.test`,
    releaseDigest: `sha256:${'a'.repeat(63)}${version.length}`,
    buildDigest: `sha256:${'b'.repeat(64)}`,
    schemaRevision,
    dependencies: [],
    dirty: false,
    yanked: false,
    publishedAt: '2026-11-20T00:00:00.000Z',
    ...extra,
  }
}

export function indexStdout(origin: string, publications: PublicationSummary[]): string {
  return JSON.stringify({ format: 'astrale.registry-index', version: 1, origin, publications })
}

export const answered = (stdout: string, stderr = '', exitCode = 0): CapturedProcess => ({
  exitCode,
  stdout,
  stderr,
  timedOut: false,
})

export const registryError = (code: string, message: string, details?: object) =>
  answered(JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }), '', 1)

export interface Recorded {
  cli: string[][]
  run: Array<{ command: string[]; options: ChildOptions }>
  island: IslandRequest[]
}

export function fakeContext(input: {
  domains: DomainHandle[]
  bundles?: Record<string, StudioSchemaBundle | null>
  cli?: (args: string[]) => CapturedProcess | Promise<CapturedProcess>
  run?: (command: string[], options: ChildOptions) => CapturedProcess | Promise<CapturedProcess>
  island?: (request: IslandRequest) => unknown
  now?: () => number
  publishing?: boolean
}): { context: VersionsContext; recorded: Recorded } {
  const recorded: Recorded = { cli: [], run: [], island: [] }
  const scratch = mkdtempSync(join(tmpdir(), 'studio-versions-scratch-'))
  roots.push(scratch)
  const context: VersionsContext = {
    cli: async (args) => {
      recorded.cli.push([...args])
      if (!input.cli) throw new Error(`unexpected CLI call: ${args.join(' ')}`)
      return input.cli([...args])
    },
    run: async (command, options) => {
      recorded.run.push({ command: [...command], options })
      if (!input.run) throw new Error(`unexpected command: ${command.join(' ')}`)
      return input.run([...command], options)
    },
    island: async (request) => {
      recorded.island.push(request)
      if (!input.island) throw new Error('unexpected island run')
      return input.island(request)
    },
    domains: () => input.domains,
    domain: (id) => input.domains.find((handle) => handle.id === id),
    bundle: async (id) => input.bundles?.[id] ?? null,
    scratch: async () => scratch,
    publishing: () => input.publishing ?? true,
    now: input.now ?? (() => Date.parse('2026-11-26T12:00:00.000Z')),
  }
  return { context, recorded }
}
