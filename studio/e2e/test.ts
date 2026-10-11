import { resolve } from 'node:path'

import { workspaceKey } from '../server/state/home'
export const FIXTURE_ID = workspaceKey(resolve(import.meta.dirname, 'fixture'))
export const PEER_ID = workspaceKey(resolve(import.meta.dirname, 'fixture/peer'))

import type {
  AgentRun,
  ChatInfo,
  ChatList,
  WorkspacePanelUiState,
  WorkspaceUiState,
} from '@shared/types'

import {
  expect,
  test as base,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test'

export type { Locator, Page }
export { expect }

const DEFAULT_WORKSPACE_UI: WorkspaceUiState = {
  version: 1,
  section: 'schema',
  edgeStyle: 'curved',
  detailWidth: 420,
  panel: {
    open: false,
    tab: 'agent',
    side: 'bottom',
    size: 360,
    dockWidth: 880,
    dockHeight: 560,
  },
  rail: { width: 240, collapsed: false },
  schema: {
    visibleDomainIds: [],
    initialized: false,
    domainPositions: {},
    externalPositions: {},
    collapsedModules: {},
    expandedDomainIds: [],
    expandedExternals: [],
  },
}

async function writeWorkspaceUi(
  request: APIRequestContext,
  state: WorkspaceUiState,
): Promise<void> {
  const response = await request.post('/api/workspace/state', {
    data: { action: 'update', state },
  })
  if (!response.ok()) {
    throw new Error(`Could not reset workspace UI: ${response.status()} ${await response.text()}`)
  }
}

/** Put the work panel on a deterministic side before the page hydrates. */
export async function dockWorkspacePanel(
  request: APIRequestContext,
  side: WorkspacePanelUiState['side'],
): Promise<void> {
  await writeWorkspaceUi(request, {
    ...DEFAULT_WORKSPACE_UI,
    panel: {
      ...DEFAULT_WORKSPACE_UI.panel,
      side,
      open: side !== 'bottom',
    },
  })
}

/**
 * Workspace UI state is machine-side and intentionally survives browser contexts. Reset it
 * before every scenario so a dock move, canvas drag or hidden domain cannot leak into the next.
 */
export const test = base.extend<{ resetWorkspaceUi: void }>({
  resetWorkspaceUi: [
    async ({ request }, use) => {
      await writeWorkspaceUi(request, DEFAULT_WORKSPACE_UI)
      await use()
    },
    { auto: true },
  ],
})

/** One chat on the stubbed agent's strip. */
export function chatInfo(id: string, title: string, status: ChatInfo['status'] = 'idle'): ChatInfo {
  const at = '2026-09-01T00:00:00.000Z'
  return {
    id,
    title,
    harness: 'claude',
    turns: 1,
    createdAt: at,
    updatedAt: at,
    status,
    queued: [],
  }
}

/**
 * Stand in for a working agent at the boundary the client reads: the snapshot, the
 * chat strip and the transcript. The fixture has no agent, so without this the
 * composer stays shut. `run` is read on every request, so a test moves a turn along
 * by changing what it returns; a route registered afterwards for one path (submit,
 * tool-call) takes precedence over this one.
 */
export async function stubAgent(
  page: Page,
  {
    run = () => null,
    history = () => [run()].filter((turn): turn is AgentRun => !!turn),
    chats,
  }: { run?: () => AgentRun | null; history?: () => AgentRun[]; chats?: ChatInfo[] } = {},
): Promise<void> {
  let activeId: string | undefined
  await page.route('**/api/agent**', (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const current = run()
    const strip = chats ?? [
      chatInfo(
        current?.chatId ?? 'chat-live',
        current?.summary ?? 'Chat',
        current?.status === 'running' ? 'running' : 'idle',
      ),
    ]
    activeId ??= strip[0]!.id
    if (path === '/api/agent/chats') {
      const body = request.method() === 'POST' ? (request.postDataJSON() as ChatSelect) : null
      if (body?.action === 'select' && body.chatId) activeId = body.chatId
      return route.fulfill({ json: { chats: strip, activeId } satisfies ChatList })
    }
    if (path === '/api/agent')
      return route.fulfill({
        json: {
          chatId: activeId,
          harness: 'claude',
          available: true,
          run: current,
          conversation: { turns: 1 },
        },
      })
    if (path === '/api/agent/history') return route.fulfill({ json: history() })
    return route.continue()
  })
}

type ChatSelect = { action?: string; chatId?: string }

/** Open real chats on the server for one test; the returned function closes them again. */
export async function openChats(
  request: APIRequestContext,
  titles: string[],
): Promise<{ opened: ChatInfo[]; close: () => Promise<void> }> {
  const opened: ChatInfo[] = []
  for (const title of titles) {
    const response = await request.post('/api/agent/chats', {
      data: { action: 'open', harness: 'claude', title },
    })
    opened.push((await response.json()) as ChatInfo)
  }
  return {
    opened,
    close: async () => {
      for (const chat of opened)
        await request.post('/api/agent/chats', { data: { action: 'close', chatId: chat.id } })
    },
  }
}

/** The response to the next chat-strip action of this kind (agent routes wait on the harness probe). */
export const chatAction = (page: Page, action: string) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/agent/chats') &&
      response.request().postDataJSON()?.action === action,
    { timeout: 30_000 },
  )
