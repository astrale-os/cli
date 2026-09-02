import type { WorkspacePanelUiState, WorkspaceUiState } from '@shared/types'

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
  panel: { open: false, tab: 'agent', side: 'bottom', size: 360 },
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
