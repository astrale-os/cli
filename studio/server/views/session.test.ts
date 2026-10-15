import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test'

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
    ownership: async () => ({ status: 'owned', instance: '@admin-instance' }),
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
      // Opened as the owner of the exact Admin Instance serving the active instance.
      owner: '@admin-instance',
      timeoutMs: 20_000,
      idleMs: 8 * 60 * 60_000,
      serveRuntime: { file: '/cli/astrale', args: [] },
    },
  ])
})

test('launches a View by any name its Schema may declare', async () => {
  const opened: { viewPath: string }[] = []
  for (const slug of ['issueBoard', 'issue_board']) {
    const named = { slug, kind: 'unknown' } satisfies ViewInfo
    const { preparationId } = await getViewRuntime('/workspace', origin, named, cli('staging'))
    expect(
      await launchViewSession(
        '/workspace',
        origin,
        named,
        { preparationId },
        2000,
        cli('staging', opened),
      ),
    ).toMatchObject({ status: 'ready' })
  }
  expect(opened.map(({ viewPath }) => viewPath)).toEqual([
    '/:issues.example.dev:view.issueBoard',
    '/:issues.example.dev:view.issue_board',
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
  // nor is a session the CLI returned without its page or its route
  expect(
    await launchViewSession('/workspace', origin, view, { preparationId }, 2000, {
      ...cli('staging'),
      open: async () => ({ id: 'v-a1b2' }) as never,
    }),
  ).toEqual({ status: 'unavailable', reason: '`astrale view` returned an invalid session.' })

  // ten minutes on, the preparation is gone rather than reused for a stale instance
  setSystemTime(new Date(Date.now() + 10 * 60_000))
  try {
    expect(await launch('/workspace', 'staging')).toEqual({
      status: 'unavailable',
      reason: 'The view preparation expired. Refresh the view and try again.',
    })
  } finally {
    setSystemTime()
  }
})

test('opens Views only on an instance its user owns in Admin, and says why otherwise', async () => {
  const { preparationId } = await getViewRuntime('/workspace', origin, view, cli('staging'))
  const opened: unknown[] = []
  const launch = (ownership: ViewSessionDependencies['ownership']) =>
    launchViewSession('/workspace', origin, view, { preparationId }, 2000, {
      ...cli('staging', opened),
      ownership,
    })

  expect(await launch(async () => ({ status: 'not-owner', instance: '@admin-instance' }))).toEqual({
    status: 'unavailable',
    reason:
      'You are not the owner of this instance in Admin: Admin does not record you as its owner.',
  })
  // A local dev Kernel, or any bookmark no Admin Instance of the user's serves.
  expect(await launch(async () => ({ status: 'not-managed' }))).toMatchObject({
    status: 'unavailable',
    reason: expect.stringMatching(/^You are not the owner of this instance in Admin:/),
  })
  expect(await launch(async () => ({ status: 'ambiguous' }))).toMatchObject({
    status: 'unavailable',
    reason: expect.stringMatching(/^You are not the owner of this instance in Admin:/),
  })
  // Admin not answering is never read as ownership.
  expect(
    await launch(async () => {
      throw new Error('Admin is unreachable.')
    }),
  ).toEqual({
    status: 'unavailable',
    reason: 'Studio could not verify in Admin that you own this instance: Admin is unreachable.',
  })
  expect(opened).toEqual([])
})
