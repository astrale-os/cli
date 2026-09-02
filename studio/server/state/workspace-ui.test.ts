import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaceStateRoot } from '../home'
import { writeJson } from './store'
import { emptyWorkspaceUiState, readWorkspaceUiState, updateWorkspaceUiState } from './workspace-ui'

const roots: string[] = []
const previousHome = process.env.ASTRALE_HOME

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
    panel: { open: true, tab: 'comments', side: 'right', size: 1_200 },
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
    panel: { open: true, tab: 'comments', side: 'right', size: 900 },
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
