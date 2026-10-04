import type {
  DomainBundle,
  DomainDependencies,
  DomainInfo,
  InstalledRelease,
  InstallRequest,
  InstallResult,
} from '@astrale-os/sdk/client/schema'
import type { DomainRelease } from '@astrale-os/sdk/release'

import { ResponseError } from '@astrale-os/sdk/client'
import { compile } from '@astrale-os/sdk/deployment/build'
import { assemble } from '@astrale-os/sdk/deployment/release'
import { defineDomain, requirements } from '@astrale-os/sdk/domain'
import { defineRuntime } from '@astrale-os/sdk/runtime'
import { bundle, classIcon, defineSchema, nodeClass, schema } from '@astrale-os/sdk/schema'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'

import type { ServedDeployment } from '../../lib/domain-release'
import type { PrecheckKernel, PrecheckRoot } from '../domain/install-precheck'
import type { ReferenceInstallDependencies } from '../domain/release-install'

import { connectAdminRegistry } from '../../admin/registry'
import {
  fakeAdmin,
  publication,
  type FakeDomain,
  type FakeRelease,
} from '../../admin/registry/__tests__/fake-admin'
import { precheckInstall, proposeDependentVersions } from '../domain/install-precheck'
import { installByReference } from '../domain/release-install'

/**
 * The install pre-check (Résolution [.78239], Installation [.69634]): before an install is sent,
 * the CLI evaluates both directions the Kernel checks ([.96185]) with the Kernel's own engine and,
 * for each installed dependent the install would break, proposes the highest stable compatible
 * Publication of it in a grouped install. The schemas are real: each fixture is a Domain built and
 * sealed by the SDK, so `compareStructure` sees exactly the bundles a Kernel would.
 */

const SHELL = 'shell.astrale.ai'
const CRM = 'crm.example.test'
const NOTES = 'notes.example.test'
const TASKS = 'tasks.example.test'
const GENERATED = '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
const INSTALLER = 'installer'
const INVOCATION = {
  source: 'https://kernel.test',
  id: 'install-precheck',
} as ConstructorParameters<typeof ResponseError>[2]

const icon = classIcon.neutral
const Member = nodeClass({ icon })
const Badge = nodeClass({ icon })
/** Shell R1 declares Member; R2 drops it for Badge (breaking); R1b adds Badge beside it. */
const ShellR1 = defineSchema(SHELL, { classes: { Member } })
const ShellR2 = defineSchema(SHELL, { classes: { Badge } })
const ShellR1b = defineSchema(SHELL, { classes: { Member, Badge } })
/** CRM 1.1.0 extends Shell R1's Member; CRM 1.2.0 was rebuilt against R2 and extends Badge. */
const CrmR1 = defineSchema(CRM, {
  dependencies: { shell: ShellR1 },
  classes: { Profile: nodeClass({ extends: [Member], icon }) },
})
const CrmR2 = defineSchema(CRM, {
  dependencies: { shell: ShellR2 },
  classes: { Card: nodeClass({ extends: [Badge], icon }) },
})
/** Notes depends on Shell R1 and uses nothing in it: every Shell revision holds for it. */
const NotesR1 = defineSchema(NOTES, {
  dependencies: { shell: ShellR1 },
  classes: { Note: nodeClass({ icon }) },
})
/** Tasks uses nothing of Shell structurally but declares Member as a capability (CT13). */
const TasksR1 = defineSchema(TASKS, {
  dependencies: { shell: ShellR1 },
  classes: { Task: nodeClass({ icon }) },
})

const R = {
  shell1: schema.revision(ShellR1),
  shell2: schema.revision(ShellR2),
  shell1b: schema.revision(ShellR1b),
  crm1: schema.revision(CrmR1),
  crm2: schema.revision(CrmR2),
}

interface Built {
  readonly url: string
  readonly document: DomainRelease
  readonly bundle: bundle.Bundle
  readonly served: ServedDeployment
}

function built<const Source extends schema.DomainSchema>(
  source: Source,
  url: string,
  required?: Parameters<typeof requirements>[0],
): Built {
  const runtime = defineRuntime<Source>()({
    integrations: {},
    initialize: () => ({ providers: {} }),
    functions: [],
  })
  const build = compile(
    defineDomain({
      schema: source,
      runtime,
      ...(required === undefined ? {} : { requirements: requirements(required) }),
    }),
  )
  const release = assemble(build, `sha256:${'b'.repeat(64)}`, url)
  const document = release.document
  return {
    url,
    document,
    bundle: bundle.decode(build.schema.bundle.bytes()),
    served: {
      origin: document.origin,
      issuer: document.identity.issuer,
      revision: document.schema.revision,
      pin: { kind: 'release', release: document.digest, build: document.build.digest },
      release: document,
    },
  }
}

const shellMember = schema.resolve(ShellR1).classes.Member
const deployments = {
  shell1: built(ShellR1, 'https://shell-r1.svc.registry-proof.test'),
  shell2: built(ShellR2, 'https://shell-r2.svc.registry-proof.test'),
  shell1b: built(ShellR1b, 'https://shell-r1b.svc.registry-proof.test'),
  crm1: built(CrmR1, 'https://crm-r1.svc.registry-proof.test'),
  crm2: built(CrmR2, 'https://crm-r2.svc.registry-proof.test'),
  notes1: built(NotesR1, 'https://notes-r1.svc.registry-proof.test'),
  tasks1: built(TasksR1, 'https://tasks-r1.svc.registry-proof.test', {
    classes: [{ class: shellMember, operations: ['read'] }],
  }),
}

function installedFrom(deployment: Built): InstalledRelease {
  return {
    origin: deployment.document.origin,
    revision: deployment.document.schema.revision,
    issuer: deployment.document.identity.issuer,
    url: new URL(deployment.url).origin,
    pin: deployment.served.pin,
    inFlight: [],
  } as unknown as InstalledRelease
}

function info(deployment: Built): DomainInfo {
  return {
    origin: deployment.document.origin,
    revision: deployment.document.schema.revision,
    capabilities: { requested: deployment.document.requirements.capabilities, materialized: {} },
  } as unknown as DomainInfo
}

/** A Kernel showing `installed` to the caller, `hidden` installed but not readable by it. */
function kernel(installed: readonly Built[], hidden: readonly string[] = []) {
  const reads: string[] = []
  const byOrigin = new Map(installed.map((entry) => [entry.document.origin, entry] as const))
  const find = (origin: string, kind: string): Built => {
    reads.push(`${kind} ${origin}`)
    const entry = byOrigin.get(origin)
    if (entry === undefined || hidden.includes(origin)) {
      throw new ResponseError(3002 as never, 'Domain not found.', INVOCATION, {
        code: 'SCHEMA_NOT_FOUND',
        details: { origin },
      })
    }
    return entry
  }
  const api: PrecheckKernel = {
    bundle: async (origin) => {
      const entry = find(origin, 'bundle')
      return { domain: info(entry), bundle: entry.bundle } as unknown as DomainBundle
    },
    inspect: async (origin) => info(find(origin, 'inspect')),
    dependencies: async (origin) => {
      const entry = find(origin, 'dependencies')
      return {
        domain: info(entry),
        dependencies: entry.bundle.closure.map((dependency) => {
          const pinned = schema.revision(dependency)
          const active = byOrigin.get(dependency.origin)?.document.schema.revision ?? pinned
          return {
            origin: dependency.origin,
            pinned,
            active,
            binding: active === pinned ? 'exact' : 'retained',
          }
        }),
      } as unknown as DomainDependencies
    },
  }
  return { api, reads }
}

function root(deployment: Built, reference = deployment.url): PrecheckRoot {
  return {
    kind: 'release',
    reference,
    origin: deployment.document.origin,
    release: deployment.document,
    bundle: deployment.bundle,
  }
}

describe('precheckInstall: the engine the Kernel uses, before the install', () => {
  test('upward: upgrading Shell to R2 breaks the installed CRM built against R1, not Notes', async () => {
    const installed = [deployments.shell1, deployments.crm1, deployments.notes1]
    const { api } = kernel(installed)

    const verdict = await precheckInstall(
      [root(deployments.shell2)],
      installed.map(installedFrom),
      api,
    )

    expect(verdict.dependencies).toEqual([])
    expect(verdict.dependents).toEqual([
      {
        domain: { origin: CRM, revision: R.crm1 },
        dependency: SHELL,
        expected: R.shell1,
        actual: R.shell2,
        changes: [expect.objectContaining({ key: shellMember.key, kind: 'missing' })],
      },
    ])
    // CRM and Notes were both compared against R2; only CRM uses what R2 changed.
    expect(verdict.compared).toBe(2)
    expect(verdict.skipped).toEqual([])
    expect(verdict.unevaluated).toEqual([])
  })

  test('a compatible upgrade (Shell R1b adds a Class) breaks nothing', async () => {
    const installed = [deployments.shell1, deployments.crm1, deployments.notes1]
    const verdict = await precheckInstall(
      [root(deployments.shell1b)],
      installed.map(installedFrom),
      kernel(installed).api,
    )

    expect(verdict.dependents).toEqual([])
    expect(verdict.dependencies).toEqual([])
    expect(verdict.compared).toBe(2)
  })

  test('installing the dependent rebuilt against R2 with Shell R2 holds in both directions', async () => {
    const installed = [deployments.shell1, deployments.crm1]
    const verdict = await precheckInstall(
      [root(deployments.shell2), root(deployments.crm2)],
      installed.map(installedFrom),
      kernel(installed).api,
    )

    // CRM 1.2.0 pins exactly the R2 the install leaves active: no comparison is needed.
    expect(verdict).toMatchObject({ compared: 0, dependencies: [], dependents: [] })
  })

  test('downward: CRM rebuilt against R2 does not hold on the installed Shell R1', async () => {
    const installed = [deployments.shell1, deployments.crm1]
    const verdict = await precheckInstall(
      [root(deployments.crm2)],
      installed.map(installedFrom),
      kernel(installed).api,
    )

    expect(verdict.dependencies).toEqual([
      {
        origin: CRM,
        dependency: SHELL,
        expected: R.shell2,
        actual: R.shell1,
        changes: [
          expect.objectContaining({
            key: schema.resolve(ShellR2).classes.Badge.key,
            kind: 'missing',
          }),
        ],
      },
    ])
    expect(verdict.dependents).toEqual([])
  })

  test('a declared capability counts as a use (CT13): Tasks breaks on R2 without using Member', async () => {
    const installed = [deployments.shell1, deployments.tasks1]
    const verdict = await precheckInstall(
      [root(deployments.shell2)],
      installed.map(installedFrom),
      kernel(installed).api,
    )

    expect(verdict.dependents).toEqual([
      expect.objectContaining({
        domain: { origin: TASKS, revision: schema.revision(TasksR1) },
        dependency: SHELL,
        changes: [expect.objectContaining({ key: shellMember.key, kind: 'missing' })],
      }),
    ])
  })

  test('a Domain the Kernel does not show the caller is unevaluated, never guessed', async () => {
    const installed = [deployments.shell1, deployments.crm1]
    const verdict = await precheckInstall(
      [root(deployments.shell2)],
      installed.map(installedFrom),
      kernel(installed, [CRM]).api,
    )

    expect(verdict.dependents).toEqual([])
    expect(verdict.unevaluated).toEqual([CRM])
  })

  test('a root without a readable v4 release is skipped by its reference', async () => {
    const installed = [deployments.shell1, deployments.crm1]
    const verdict = await precheckInstall(
      [
        {
          kind: 'skipped',
          reference: 'https://legacy.example.test',
          origin: SHELL,
          revision: R.shell2,
          reason: 'legacy',
        },
      ],
      installed.map(installedFrom),
      kernel(installed).api,
    )

    expect(verdict).toMatchObject({
      compared: 0,
      dependents: [],
      skipped: [{ reference: 'https://legacy.example.test', reason: 'legacy' }],
    })
  })
})

function crmRegistry(): FakeDomain {
  const release = (deployment: Built, name: string): FakeRelease => ({
    url: deployment.url,
    releaseDigest: deployment.document.digest,
    buildDigest: deployment.document.build.digest,
    bytes: new TextEncoder().encode(name),
  })
  const atR1 = { schemaRevision: R.crm1, dependencies: [{ origin: SHELL, revision: R.shell1 }] }
  const atR2 = { schemaRevision: R.crm2, dependencies: [{ origin: SHELL, revision: R.shell2 }] }
  return {
    id: 'domain-crm',
    origin: CRM,
    admins: new Set(['publisher']),
    installers: new Set([INSTALLER]),
    publications: [
      publication('110', '1.1.0', release(deployments.crm1, 'crm-110'), atR1),
      publication('120', '1.2.0', release(deployments.crm2, 'crm-120'), atR2),
      publication('125', '1.2.5', release(deployments.crm2, 'crm-125'), {
        ...atR2,
        yankedAt: '2026-10-04T12:00:00.000Z',
      }),
      publication('130', '1.3.0-rc.1', release(deployments.crm2, 'crm-130'), atR2),
      publication('140', '1.4.0', release(deployments.crm1, 'crm-140'), atR1),
    ],
  }
}

function shellRegistry(): FakeDomain {
  return {
    id: 'domain-shell',
    origin: SHELL,
    admins: new Set(['publisher']),
    installers: new Set([INSTALLER]),
    publications: [
      publication(
        '100',
        '1.0.0',
        {
          url: deployments.shell1.url,
          releaseDigest: deployments.shell1.document.digest,
          buildDigest: deployments.shell1.document.build.digest,
          bytes: new TextEncoder().encode('shell-100'),
        },
        { schemaRevision: R.shell1, dependencies: [] },
      ),
      publication(
        '200',
        '2.0.0',
        {
          url: deployments.shell2.url,
          releaseDigest: deployments.shell2.document.digest,
          buildDigest: deployments.shell2.document.build.digest,
          bytes: new TextEncoder().encode('shell-200'),
        },
        { schemaRevision: R.shell2, dependencies: [] },
      ),
    ],
  }
}

describe('proposeDependentVersions: the registry names a compatible dependent (R-F07)', () => {
  const broken = {
    domain: { origin: CRM, revision: R.crm1 },
    dependency: SHELL,
    expected: R.shell1,
    actual: R.shell2,
    changes: [{ key: shellMember.key, kind: 'missing' as const }],
  }

  test('the highest stable, non-yanked Publication built against the new revision', async () => {
    const admin = fakeAdmin({ caller: INSTALLER, domains: [crmRegistry()] })

    await expect(
      proposeDependentVersions([broken], connectAdminRegistry(admin.context)),
    ).resolves.toEqual([{ origin: CRM, kind: 'version', version: '1.2.0' }])
  })

  test('no Publication built against the new revision: none', async () => {
    const admin = fakeAdmin({ caller: INSTALLER, domains: [crmRegistry()] })

    await expect(
      proposeDependentVersions(
        [{ ...broken, actual: R.shell1b }],
        connectAdminRegistry(admin.context),
      ),
    ).resolves.toEqual([{ origin: CRM, kind: 'none' }])
  })

  test('a Domain the caller cannot read in the registry has no published version for it', async () => {
    const admin = fakeAdmin({ caller: 'outsider', domains: [crmRegistry()] })

    await expect(
      proposeDependentVersions([broken], connectAdminRegistry(admin.context)),
    ).resolves.toEqual([{ origin: CRM, kind: 'none' }])
  })
})

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
  process.exit = originalExit
  process.stdout.write = originalStdout
  process.stderr.write = originalStderr
})

/** The Kernel refusal a real Kernel gives the Shell R2 upgrade of the fixture instance. */
function dependentsIncompatible(): ResponseError {
  return new ResponseError(
    4002 as never,
    'Upgrading shell.astrale.ai changes meaning used by installed crm.example.test.',
    INVOCATION,
    {
      code: 'SCHEMA_DEPENDENTS_INCOMPATIBLE',
      details: {
        targets: [{ origin: SHELL, revision: R.shell2 }],
        dependents: [
          {
            domain: { origin: CRM, revision: R.crm1 },
            dependency: SHELL,
            expected: R.shell1,
            actual: R.shell2,
            changes: [{ key: shellMember.key, kind: 'missing' }],
          },
        ],
      },
    },
  )
}

function install(options: {
  readonly installed: readonly Built[]
  readonly served: readonly Built[]
  readonly install?: (request: InstallRequest) => Promise<InstallResult>
  readonly registry?: 'down'
}) {
  const admin = fakeAdmin({ caller: INSTALLER, domains: [shellRegistry(), crmRegistry()] })
  const { api, reads } = kernel(options.installed)
  const requests: InstallRequest[] = []
  const byUrl = new Map(options.served.map((entry) => [entry.url, entry] as const))
  let registries = 0
  let listing = options.installed.map(installedFrom)
  const session = {
    schema: {
      ...api,
      installed: async () => listing,
      install: async (request: InstallRequest) => {
        requests.push(request)
        if (options.install === undefined) throw dependentsIncompatible()
        const result = await options.install(request)
        // A committed install lists each root at the deployment it now pins.
        const pinned = request.domains.map((domain) =>
          byUrl.get((domain as { release: { url: string } }).release.url)!,
        )
        const origins = new Set(pinned.map(({ document }) => document.origin))
        listing = [
          ...listing.filter((entry) => !origins.has(entry.origin)),
          ...pinned.map(installedFrom),
        ]
        return result
      },
    },
  }
  const deps: Partial<ReferenceInstallDependencies> = {
    createOperationId: () => GENERATED,
    withClientSession: (async (_opts: unknown, action: (context: never) => Promise<unknown>) =>
      action({ session } as never)) as unknown as ReferenceInstallDependencies['withClientSession'],
    openRegistry: async (_opts, work) => {
      registries += 1
      if (options.registry === 'down') throw new TypeError('Admin answered nonsense.')
      return work(connectAdminRegistry(admin.context))
    },
    readDeployment: async (url: string) => {
      const entry = byUrl.get(url)
      if (entry === undefined) throw new Error(`GET ${url} failed.`)
      return entry.served
    },
    readBundle: async (release) => {
      const entry = [...byUrl.values()].find(({ document }) => document.digest === release.digest)
      if (entry === undefined) throw new Error('bundle unreadable')
      return entry.bundle
    },
    now: () => 0,
    sleep: async () => {},
  }
  return {
    deps,
    requests,
    reads,
    get registries() {
      return registries
    },
  }
}

async function human(action: () => Promise<void>): Promise<{ lines: string; warnings: string }> {
  const lines: string[] = []
  const warnings: string[] = []
  const originalLog = console.log
  const originalError = console.error
  const tty = process.stdout.isTTY
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  }
  console.error = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
  process.stdout.isTTY = true
  try {
    await action()
  } finally {
    console.log = originalLog
    console.error = originalError
    process.stdout.isTTY = tty
  }
  return {
    lines: stripVTControlCharacters(lines.join('\n')),
    warnings: stripVTControlCharacters(warnings.join('\n')),
  }
}

describe('install pre-check in the install command ([.69634])', () => {
  test('a breaking Shell install proposes the grouped install with the compatible dependent', async () => {
    const run = install({
      installed: [deployments.shell1, deployments.crm1, deployments.notes1],
      served: [deployments.shell2],
    })

    const output = await human(async () => {
      await expect(
        installByReference(
          [`${SHELL}@2.0`],
          { instance: 'acme', admin: 'admin', allowIssuerChange: [SHELL] },
          run.deps,
        ),
      ).rejects.toThrow('process.exit(1)')
    })

    const all = `${output.lines}\n${output.warnings}`
    expect(all).toContain(`Pre-check: installing ${SHELL}`)
    expect(all).toContain(`breaks installed ${CRM}`)
    expect(all).toContain(
      `Proposed grouped install: astrale domain install ${SHELL}@2.0.0 ${CRM}@1.2.0 --allow-issuer-change=${SHELL} -i acme --admin admin`,
    )
    expect(all).toContain('the install is sent and the Kernel decides')
    // Advisory: the install is still sent once, and the Kernel's refusal decides.
    expect(run.requests).toHaveLength(1)
    expect(all).toContain('SCHEMA_DEPENDENTS_INCOMPATIBLE')
    expect(all).toContain(
      `The pre-check proposes: astrale domain install ${SHELL}@2.0.0 ${CRM}@1.2.0 --allow-issuer-change=${SHELL} -i acme --admin admin`,
    )
  })

  test('--json: the refusal carries the pre-check, whose verdict is the Kernel refusal', async () => {
    const run = install({
      installed: [deployments.shell1, deployments.crm1, deployments.notes1],
      served: [deployments.shell2],
    })

    await expect(
      installByReference(
        [`${SHELL}@2.0.0`],
        { json: true, instance: 'acme', allowIssuerChange: [SHELL] },
        run.deps,
      ),
    ).rejects.toThrow('process.exit(1)')

    const document = JSON.parse(stderr.trim().split('\n').at(-1)!) as {
      error: string
      code: number
      reason: { code: string; details: { dependents: unknown } }
      precheck: { dependents: unknown; proposals: unknown; command: string }
    }
    expect(document.error).toBe('RESPONSE_ERROR')
    expect(document.reason.code).toBe('SCHEMA_DEPENDENTS_INCOMPATIBLE')
    // The verdicts agree: the pre-check named exactly the dependents the Kernel refused.
    expect(document.precheck.dependents).toEqual(document.reason.details.dependents)
    expect(document.precheck.proposals).toEqual([
      { origin: CRM, kind: 'version', version: '1.2.0' },
    ])
    expect(document.precheck.command).toBe(
      `astrale domain install ${SHELL}@2.0.0 ${CRM}@1.2.0 --allow-issuer-change=${SHELL} -i acme`,
    )
  })

  test('the proposed grouped install passes the pre-check and installs', async () => {
    const run = install({
      installed: [deployments.shell1, deployments.crm1],
      served: [deployments.shell2, deployments.crm2],
      install: async () => ({ changed: false, domains: [] }) as unknown as InstallResult,
    })

    await installByReference(
      [`${SHELL}@2.0.0`, `${CRM}@1.2.0`],
      { json: true, allowIssuerChange: [SHELL, CRM] },
      run.deps,
    )

    const report = JSON.parse(stdout) as { precheck: unknown }
    expect(report.precheck).toEqual({
      compared: 0,
      dependencies: [],
      dependents: [],
      proposals: [],
      skipped: [],
      unevaluated: [],
    })
    expect(run.requests).toHaveLength(1)
    // Nothing broke, so the registry was read only to resolve the two versions.
    expect(run.registries).toBe(1)
  })

  test('a URL install the pre-check passes never opens the registry', async () => {
    const run = install({
      installed: [deployments.shell1, deployments.crm1, deployments.notes1],
      served: [deployments.shell1b],
      install: async () => ({ changed: false, domains: [] }) as unknown as InstallResult,
    })

    await installByReference(
      [deployments.shell1b.url],
      { json: true, allowIssuerChange: [SHELL] },
      run.deps,
    )

    const report = JSON.parse(stdout) as { precheck: { compared: number; dependents: unknown[] } }
    expect(report.precheck.compared).toBe(2)
    expect(report.precheck.dependents).toEqual([])
    expect(run.registries).toBe(0)
  })

  test('without an answering registry the breaking install is still sent, with no proposal', async () => {
    const run = install({
      installed: [deployments.shell1, deployments.crm1],
      served: [deployments.shell2],
      registry: 'down',
    })

    await expect(
      installByReference(
        [deployments.shell2.url],
        { json: true, allowIssuerChange: [SHELL] },
        run.deps,
      ),
    ).rejects.toThrow('process.exit(1)')

    const document = JSON.parse(stderr.trim().split('\n').at(-1)!) as {
      precheck: { proposals: unknown; command?: string }
    }
    expect(document.precheck.proposals).toEqual([
      { origin: CRM, kind: 'unread', code: 'REGISTRY_UNAVAILABLE' },
    ])
    expect(document.precheck.command).toBeUndefined()
    expect(run.requests).toHaveLength(1)
  })
})
