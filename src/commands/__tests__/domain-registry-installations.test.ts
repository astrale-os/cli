import type { Call } from '@astrale-os/sdk/client'

import { ResponseError } from '@astrale-os/sdk/client'
import { describe, expect, test } from 'bun:test'

import type { InstallationsDependencies } from '../domain-registry/installations'

import { connectAdminFleet } from '../../admin/fleet'
import { runInstallations } from '../domain-registry/installations'

const ORIGIN = 'issues.astrale.ai'
const R1 = `sha256:${'1'.repeat(64)}`
const B1 = `sha256:${'b'.repeat(64)}`

/** The command against a fake Admin whose `Fleet.installations` answers `answer`. */
function harness(answer: () => unknown) {
  const written: string[] = []
  const inputs: unknown[] = []
  let opened = 0
  const dependencies: InstallationsDependencies = {
    open: async (_opts, work) => {
      opened += 1
      return work(
        connectAdminFleet({
          session: {
            call: async (request: Call) => {
              inputs.push(request.input)
              const value = answer()
              if (value instanceof Error) throw value
              return value
            },
          } as never,
        }),
      )
    },
    write: (text) => written.push(text),
  }
  return {
    dependencies,
    inputs,
    opened: () => opened,
    stdout: () => JSON.parse(written.join('')) as Record<string, unknown>,
  }
}

describe('astrale __domain-registry installations (CT24 over CT37)', () => {
  test('prints one astrale.fleet-installations document with the unreachable rows, exit 0', async () => {
    const run = harness(() => ({
      installations: [
        {
          fleet: '@fleet-acme',
          instance: { id: '@instance-acme-prod', slug: 'acme-prod' },
          pin: { kind: 'release', release: R1, build: B1 },
          url: 'https://issues-production.deployments.astrale.ai',
        },
      ],
      unreachable: [{ instance: '@instance-1pact', reason: 'unsupported' }],
    }))
    expect(await runInstallations(ORIGIN, { release: [R1] }, run.dependencies)).toBe(0)
    expect(run.inputs).toEqual([{ origin: ORIGIN, releases: [R1] }])
    expect(run.stdout()).toEqual({
      format: 'astrale.fleet-installations',
      version: 1,
      origin: ORIGIN,
      releases: [R1],
      fleetView: true,
      installations: [
        {
          fleet: '@fleet-acme',
          instance: { id: '@instance-acme-prod', slug: 'acme-prod' },
          pin: { kind: 'release', release: R1, build: B1 },
          url: 'https://issues-production.deployments.astrale.ai',
        },
      ],
      unreachable: [{ instance: '@instance-1pact', reason: 'unsupported' }],
    })
  })

  test('a caller outside the central Shell members has no Fleet view: exit 0, not an error', async () => {
    const run = harness(() => new ResponseError(2004 as never, 'ACCESS_DENIED', 'inv' as never))
    expect(await runInstallations(ORIGIN, {}, run.dependencies)).toBe(0)
    expect(run.stdout()).toMatchObject({ fleetView: false, installations: [], unreachable: [] })
  })

  test('a refusal is one error document on stdout and exit 1', async () => {
    const run = harness(() => new ResponseError(5001 as never, 'UNAVAILABLE', 'inv' as never))
    expect(await runInstallations(ORIGIN, {}, run.dependencies)).toBe(1)
    expect(run.stdout()).toEqual({
      error: {
        code: 'REGISTRY_UNAVAILABLE',
        message: expect.any(String),
        details: { status: 5001 },
      },
    })
  })

  test('an origin or a release digest that is not one is refused before Admin is opened', async () => {
    for (const [origin, release] of [
      ['issues.astrale.ai@1.5', undefined],
      [ORIGIN, ['1.5.0']],
    ] as const) {
      const run = harness(() => ({ installations: [], unreachable: [] }))
      expect(
        await runInstallations(origin, release === undefined ? {} : { release }, run.dependencies),
      ).toBe(1)
      expect((run.stdout().error as { code: string }).code).toBe('INVALID_ARGUMENT')
      expect(run.opened()).toBe(0)
    }
  })
})
