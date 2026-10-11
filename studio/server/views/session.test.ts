import { afterEach, beforeEach, expect, test } from 'bun:test'

import type { ViewInfo } from '../../shared/contracts/schema'

import { STUDIO_CLI_DESCRIPTOR_ENV } from '../cli'
import { getViewRuntime, launchViewSession, type ViewSessionDependencies } from './session'

const priorDescriptor = process.env[STUDIO_CLI_DESCRIPTOR_ENV]
const view = { slug: 'issues', kind: 'unknown' } satisfies ViewInfo
const origin = 'issues.example.dev'

beforeEach(() => {
  process.env[STUDIO_CLI_DESCRIPTOR_ENV] = JSON.stringify({
    version: 1,
    executable: '/cli/astrale',
    args: [],
  })
})

afterEach(() => {
  if (priorDescriptor === undefined) delete process.env[STUDIO_CLI_DESCRIPTOR_ENV]
  else process.env[STUDIO_CLI_DESCRIPTOR_ENV] = priorDescriptor
})

function cli(active: string, opened: unknown[] = []): Partial<ViewSessionDependencies> {
  return {
    activeInstance: async () => active,
    open: async (input) => {
      opened.push(input)
      return {
        id: 'v-a1b2',
        pageUrl: 'http://127.0.0.1:4419/s/nonce/',
        view: { route: { href: 'https://issues.example/ui/issues' } },
      } as never
    },
  }
}

test('launches the canonical ViewPath on the instance the preparation pinned', async () => {
  const runtime = await getViewRuntime('/workspace', origin, view, cli('staging'))
  expect(runtime).toEqual({
    slug: 'issues',
    preparationId: expect.stringMatching(/^[0-9a-f]{24}$/),
    instance: 'staging',
  })

  const opened: unknown[] = []
  const request = { preparationId: runtime.preparationId }
  expect(
    await launchViewSession('/workspace', origin, view, request, 2000, cli('staging', opened)),
  ).toEqual({
    status: 'ready',
    sessionId: 'v-a1b2',
    pageUrl: 'http://127.0.0.1:4419/s/nonce/',
    viewUrl: 'https://issues.example/ui/issues',
  })
  expect(opened).toEqual([
    {
      viewPath: '/:issues.example.dev:view.issues',
      instance: 'staging',
      timeoutMs: 20_000,
      idleMs: 8 * 60 * 60_000,
      serveRuntime: { file: '/cli/astrale', args: [] },
    },
  ])
})

test('refuses a launch the preparation does not cover', async () => {
  const { preparationId } = await getViewRuntime('/workspace', origin, view, cli('staging'))
  const launch = (root: string, active: string) =>
    launchViewSession(root, origin, view, { preparationId }, 2000, cli(active))

  // another workspace, or an instance switched since the View was shown
  expect(await launch('/other', 'staging')).toMatchObject({ status: 'unavailable' })
  expect(await launch('/workspace', 'production')).toEqual({
    status: 'unavailable',
    reason: 'The active instance changed. Refresh the view and try again.',
  })
  expect(
    await launchViewSession('/workspace', origin, view, { preparationId }, 2000, {
      ...cli('staging'),
      open: async () => {
        throw new Error('Permission denied.')
      },
    }),
  ).toEqual({ status: 'unavailable', reason: 'Permission denied.' })
})
