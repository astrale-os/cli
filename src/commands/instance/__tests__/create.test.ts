import { afterEach, expect, mock, spyOn, test } from 'bun:test'

import type { ProvisionResult } from '../../../lib/provision-instance'

import * as provisioning from '../../../lib/provision-instance'
import command from '../create'

const originalExitCode = process.exitCode
afterEach(() => {
  mock.restore()
  process.exitCode = originalExitCode ?? 0
})

test.each([
  { state: 'provisioning', access: undefined, exitCode: 1 },
  {
    state: 'ready',
    access: { status: 'pending', code: 'OWNER_ACTIVATION_UNAVAILABLE' },
    exitCode: 1,
  },
  { state: 'ready', access: { status: 'completed', user: 'reserved-owner' }, exitCode: 0 },
] as const)(
  'create reports the retained $state receipt and actual access outcome',
  async ({ state, access, exitCode }) => {
    let stdout = ''
    spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk)
      return true
    })
    process.exitCode = 0
    const created = {
      id: '@same-instance',
      slug: 'demo',
      url: 'https://demo.example/api',
      operationId: 'same-operation',
      state,
    }
    const provisionInstance = spyOn(provisioning, 'provisionInstance').mockImplementation(
      async (): Promise<ProvisionResult> => ({
        created,
        slug: 'demo',
        access,
      }),
    )
    const options = { json: true, as: 'creator' }

    await command.action('demo', options)

    expect(provisionInstance).toHaveBeenCalledWith('demo', options)
    expect(Number(process.exitCode)).toBe(exitCode)
    expect(JSON.parse(stdout)).toEqual({ ...created, ...(access === undefined ? {} : { access }) })
    expect(stdout).toBe(`${JSON.stringify(JSON.parse(stdout), null, 2)}\n`)
  },
)

test('create returns the ready receipt and verified access alongside a recoverable bookmark conflict', async () => {
  let stdout = ''
  spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })
  process.exitCode = 0
  const created = {
    id: '@created-instance',
    slug: 'prod',
    url: 'https://prod.example.test/api',
    operationId: 'retained-operation',
    state: 'ready' as const,
  }
  const access = { status: 'completed' as const, user: 'verified-owner' }
  const bookmark = {
    status: 'pending' as const,
    code: 'INSTANCE_BOOKMARK_CONFLICT',
    message: 'The existing bookmark and active target were preserved.',
    hint: "Choose an unused bookmark name: astrale instance bookmark <new-name> --url 'https://prod.example.test/api' --as creator",
  }
  spyOn(provisioning, 'provisionInstance').mockImplementation(async () => ({
    created,
    slug: created.slug,
    access,
    bookmark,
  }))

  await command.action('prod', { json: true, as: 'creator' })

  expect(Number(process.exitCode)).toBe(1)
  expect(JSON.parse(stdout)).toEqual({ ...created, access, bookmark })
  expect(stdout).toBe(`${JSON.stringify(JSON.parse(stdout), null, 2)}\n`)
})
