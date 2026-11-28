import { resolve } from 'node:path'

import { workspaceKey } from '../server/state/home'
export const FIXTURE_ID = workspaceKey(resolve(import.meta.dirname, 'fixture'))
export const PEER_ID = workspaceKey(resolve(import.meta.dirname, 'fixture/peer'))

import type { AgentRun, ChatInfo, ChatList } from '@shared/contracts/agent'
import type { Scenario, ScenarioStore } from '@shared/contracts/scenarios'
import type { DefinitionLink } from '@shared/contracts/schema'

import {
  expect,
  test as base,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test'
import { revisionOf } from '@shared/contracts/scenarios'
import {
  WORKSPACE_MAP_ID,
  type WorkspacePanelUiState,
  type WorkspaceUiState,
} from '@shared/contracts/workspace'

export type { Locator, Page }
export { expect }

const DEFAULT_WORKSPACE_UI: WorkspaceUiState = {
  version: 1,
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
}

async function writeWorkspaceUi(
  request: APIRequestContext,
  state: WorkspaceUiState,
): Promise<void> {
  // An update keeps the Domain the readers last opened unless told to forget it: null does.
  const response = await request.post('/api/workspace/state', {
    data: { action: 'update', state: { ...state, readerDomainId: state.readerDomainId ?? null } },
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

/** Where a map's arrangement is kept: a Domain's, or the Workspace map's. */
export const layoutRoute = (mapId: string): string =>
  mapId === WORKSPACE_MAP_ID
    ? '/api/workspace/layout'
    : `/api/domain/${encodeURIComponent(mapId)}/layout`

/** Forget every arrangement a map remembers, every lens's included. */
export async function resetLayout(request: APIRequestContext, mapId: string): Promise<void> {
  const response = await request.post(layoutRoute(mapId), { data: { action: 'reset' } })
  if (!response.ok()) {
    throw new Error(`Could not reset the layout of ${mapId}: ${response.status()}`)
  }
}

/**
 * Workspace UI state and each map's arrangement are machine-side and intentionally survive
 * browser contexts. Reset them before every scenario so a dock move, a dragged card or a
 * collapsed module cannot leak into the next.
 */
export const test = base.extend<{ resetWorkspaceUi: void }>({
  resetWorkspaceUi: [
    async ({ request }, use) => {
      await writeWorkspaceUi(request, DEFAULT_WORKSPACE_UI)
      await resetLayout(request, FIXTURE_ID)
      await resetLayout(request, PEER_ID)
      await resetLayout(request, WORKSPACE_MAP_ID)
      await use()
    },
    { auto: true },
  ],
})

// ─── The Studio's surfaces ─────────────────────────────────────────────────────

/** The Scene canvas of the level on screen. */
export const sceneCanvas = (page: Page): Locator => page.getByTestId('scene-canvas')

/** One card on the canvas, by its selection target (`class.Invoice`, `domain:<id>`…). */
export const sceneBox = (page: Page, id: string): Locator =>
  page.locator(`.scene-box[data-box-id="${id}"]`)

/** One drawn link, by its selection target (`class.WorksAt`, `core.edge.0`…). */
export const sceneLink = (page: Page, id: string): Locator =>
  page.locator(`g.scene-link[data-select-id="${id}"]`)

/** The Index rail. */
export const indexRail = (page: Page): Locator => page.getByTestId('index-rail')

/** One Index row, by the selection target it lists. */
export const indexRow = (page: Page, id: string): Locator =>
  indexRail(page).locator(`[data-index-row="${id}"]`)

/** The Schema level's Inspector, whatever lens it reads through. */
export const inspector = (page: Page): Locator => page.locator('[data-inspector-lens]')

/** One lens of the bar's switch at the Schema level. */
export const lensButton = (
  page: Page,
  lens: 'structure' | 'behavior' | 'rules' | 'views',
): Locator => page.getByTestId('lens-switch').locator(`button[data-lens="${lens}"]`)

/** One tab of the bar's switch at the Data level. */
export const dataTabButton = (page: Page, tab: 'query' | 'access' | 'scenarios'): Locator =>
  page.getByTestId('lens-switch').locator(`button[data-tab="${tab}"]`)

/** One segment of the bar's Schema | Data switch. */
export const levelButton = (page: Page, level: 'schema' | 'data'): Locator =>
  page.getByTestId('level-switch').locator(`button[data-level="${level}"]`)

/** The open dataset's label on the Data level's canvas: its name, and the way to every dataset. */
export const datasetLabel = (page: Page): Locator => page.getByTestId('dataset-label')

/** One dataset's card on a Domain's Datasets page, by its module path. */
export const datasetCard = (page: Page, path: string): Locator =>
  page.locator(`[data-dataset-card="${path}"]`)

/** Open a dataset from its Domain's Datasets page, by its module path. */
export async function openDatasetCard(page: Page, path: string): Promise<void> {
  await datasetCard(page, path).locator('[data-action="open-dataset"]').click()
}

/** Open the Studio on the fixture Domain's Schema and wait for its canvas to draw. */
export async function openSchema(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByTestId('schema-level')).toBeVisible()
  await expect(sceneBox(page, 'class.Invoice')).toBeVisible({ timeout: 60_000 })
}

/**
 * Open the fixture's Data level from its Schema and wait for the dataset to be read. Support desk
 * is the one dataset the fixture can read: Data opens it, on the tab last read.
 */
export async function openSupportDesk(page: Page): Promise<void> {
  await openSchema(page)
  await levelButton(page, 'data').click()
  const level = page.getByTestId('data-level')
  await expect(level).toHaveAttribute('data-state', 'ready')
  await expect(level).toHaveAttribute('data-dataset', 'support-desk')
}

type Rect = { x: number; y: number; width: number; height: number }

/**
 * Wait for the camera to come to rest, then require the target wholly inside the canvas. A reveal
 * animates, and a card crossing the canvas on its way elsewhere is not in view: a reading counts
 * only once two looks 150 ms apart agree. The target is a locator, or a reader of a screen rect
 * (a point is a rect of no size).
 */
export async function restsInCanvas(
  page: Page,
  target: Locator | (() => Promise<Rect | null>),
): Promise<void> {
  const read = typeof target === 'function' ? target : () => target.boundingBox()
  let last = ''
  await expect
    .poll(
      async () => {
        const [canvas, rect] = [
          await sceneCanvas(page).boundingBox(),
          await read().catch(() => null),
        ]
        const now = JSON.stringify([canvas, rect])
        const still = now === last
        last = now
        if (!still || !canvas || !rect) return 'moving'
        const inside =
          rect.x >= canvas.x &&
          rect.y >= canvas.y &&
          rect.x + rect.width <= canvas.x + canvas.width &&
          rect.y + rect.height <= canvas.y + canvas.height
        return inside ? 'inside' : 'outside'
      },
      { intervals: [150] },
    )
    .toBe('inside')
}

/** Every selection target the canvas draws as a card, in DOM order. */
export const drawnBoxes = (page: Page): Promise<string[]> =>
  page
    .locator('.scene-box[data-box-id]')
    .evaluateAll((boxes) => boxes.map((box) => (box as HTMLElement).dataset.boxId!))

/** Every selection target the canvas draws as a link, in DOM order. */
export const drawnLinks = (page: Page): Promise<string[]> =>
  page
    .locator('g.scene-link[data-select-id]')
    .evaluateAll((links) => links.map((link) => (link as SVGElement).dataset.selectId!))

/** Every selection target the Index lists, in order. */
export const listedRows = (page: Page): Promise<string[]> =>
  indexRail(page)
    .locator('[data-index-row]')
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.indexRow!))

/** The fixture Domain's bundle, as the Studio server answers it. */
export async function fixtureBundle(request: APIRequestContext): Promise<{
  ir: {
    classes: Record<
      string,
      { type: 'node' | 'edge'; abstract?: boolean; endpoints?: { name: string; types: string[] }[] }
    >
  }
  overlay: { definitions: DefinitionLink[] }
}> {
  const response = await request.get(`/api/domain/${encodeURIComponent(FIXTURE_ID)}/bundle`)
  expect(response.ok()).toBe(true)
  return response.json()
}

// ─── Scenarios ─────────────────────────────────────────────────────────────────

/** Where the fixture Domain's Scenarios are read and written. */
export const scenariosRoute = `/api/domain/${encodeURIComponent(FIXTURE_ID)}/scenarios`

/** Every Scenario the fixture Domain keeps, every dataset's. */
export async function storedScenarios(request: APIRequestContext): Promise<readonly Scenario[]> {
  return ((await (await request.get(scenariosRoute)).json()) as ScenarioStore).scenarios
}

/**
 * Delete every Scenario the fixture Domain keeps. The suite's reset leaves `scenarios.json` as it
 * is: a test that writes Scenarios starts and ends with none.
 */
export async function clearScenarios(request: APIRequestContext): Promise<void> {
  const store = (await (await request.get(scenariosRoute)).json()) as ScenarioStore
  for (const scenario of store.scenarios) {
    const response = await request.post(scenariosRoute, {
      data: { action: 'delete', id: scenario.id, revision: revisionOf(store, scenario.id) },
    })
    expect(response.ok()).toBe(true)
  }
}

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
