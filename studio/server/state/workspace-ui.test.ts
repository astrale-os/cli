import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaceStateRoot } from '../home'
import { writeJson } from './store'
import {
  emptyWorkspaceUiState,
  readWorkspaceUiState,
  updateWorkspaceUiState,
  remapWorkspaceDomainIds,
} from './workspace-ui'

const roots: string[] = []
const previousHome = process.env.ASTRALE_HOME

test('retains canvas preferences when qualifying domain IDs and preserves already migrated entries', () => {
  const state = emptyWorkspaceUiState()
  state.readerDomainId = 'domain'
  state.schema.visibleDomainIds = ['domain', 'domain-admin']
  state.schema.expandedDomainIds = ['domain']
  state.schema.domainPositions = { domain: { x: 1, y: 2 }, 'domain-admin': { x: 3, y: 4 } }
  state.schema.collapsedModules = { domain: ['billing'] }
  const migrated = remapWorkspaceDomainIds(state, [
    { id: 'domain-ui', root: '/workspace/ui/domain' },
    { id: 'domain-admin', root: '/workspace/admin/domain' },
  ])
  expect(migrated.readerDomainId).toBe('domain-admin')
  expect(migrated.schema.visibleDomainIds).toEqual(['domain-admin'])
  expect(migrated.schema.expandedDomainIds).toEqual(['domain-admin'])
  expect(migrated.schema.domainPositions).toEqual({ 'domain-admin': { x: 3, y: 4 } })
  expect(migrated.schema.collapsedModules).toEqual({ 'domain-admin': ['billing'] })
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.ASTRALE_HOME
  else process.env.ASTRALE_HOME = previousHome
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function machineWorkspace(name: string): string {
  const machine = mkdtempSync(join(tmpdir(), 'studio-workspace-ui-'))
  roots.push(machine)
  process.env.ASTRALE_HOME = join(machine, '.astrale')
  return workspaceStateRoot(join(machine, name))
}

test('keeps one validated UI state per workspace on the machine', () => {
  const alpha = machineWorkspace('alpha')
  const beta = workspaceStateRoot(join(roots[0]!, 'beta'))
  expect(readWorkspaceUiState(alpha)).toEqual(emptyWorkspaceUiState())

  const saved = updateWorkspaceUiState(alpha, {
    section: 'core',
    readerDomainId: 'orders',
    edgeStyle: 'orthogonal',
    panel: {
      open: true,
      tab: 'comments',
      side: 'right',
      size: 1_200,
      dockWidth: 5_000,
      dockHeight: 12,
    },
    rail: { width: 90, collapsed: true },
    schema: {
      visibleDomainIds: ['orders', 'orders', '', 'billing'],
      initialized: true,
      domainPositions: {
        orders: { x: 12, y: 24 },
        invalid: { x: '12', y: 24 },
      },
      externalPositions: {},
      collapsedModules: { orders: ['sales', 'sales'], invalid: 'nope' },
      expandedDomainIds: ['orders'],
      expandedExternals: ['kernel.astrale.ai'],
    },
  })

  expect(saved).toMatchObject({
    version: 1,
    section: 'core',
    readerDomainId: 'orders',
    edgeStyle: 'orthogonal',
    panel: {
      open: true,
      tab: 'comments',
      side: 'right',
      size: 900,
      dockWidth: 1_600,
      dockHeight: 200,
    },
    rail: { width: 180, collapsed: true },
    schema: {
      visibleDomainIds: ['orders', 'billing'],
      domainPositions: { orders: { x: 12, y: 24 } },
      collapsedModules: { orders: ['sales'] },
    },
  })
  expect(readWorkspaceUiState(alpha)).toEqual(saved)
  expect(readWorkspaceUiState(beta)).toEqual(emptyWorkspaceUiState())
})

test('does not migrate unversioned UI state and can explicitly clear reader scope', () => {
  const root = machineWorkspace('legacy')
  writeJson(root, 'ui.json', { section: 'data', selectedDomainIds: ['legacy'] })
  expect(readWorkspaceUiState(root)).toEqual(emptyWorkspaceUiState())

  updateWorkspaceUiState(root, { readerDomainId: 'orders' })
  expect(readWorkspaceUiState(root).readerDomainId).toBe('orders')
  updateWorkspaceUiState(root, { readerDomainId: null })
  expect(readWorkspaceUiState(root).readerDomainId).toBeUndefined()
})

test('a dock still on its first default size grows to the current one; a chosen size stays', () => {
  const root = machineWorkspace('dock')
  const panel = { open: false, tab: 'agent', side: 'bottom', size: 360 }
  writeJson(root, 'ui.json', { version: 1, panel: { ...panel, dockWidth: 768, dockHeight: 480 } })
  const fresh = emptyWorkspaceUiState().panel
  expect(readWorkspaceUiState(root).panel).toMatchObject({
    dockWidth: fresh.dockWidth,
    dockHeight: fresh.dockHeight,
  })
  expect(fresh.dockWidth).toBeGreaterThan(768)
  expect(fresh.dockHeight).toBeGreaterThan(480)

  // only the untouched PAIR moves: one edge dragged is a size somebody picked
  writeJson(root, 'ui.json', { version: 1, panel: { ...panel, dockWidth: 768, dockHeight: 620 } })
  expect(readWorkspaceUiState(root).panel).toMatchObject({ dockWidth: 768, dockHeight: 620 })
})
