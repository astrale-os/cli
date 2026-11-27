import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WORKSPACE_UI_LIMITS } from '../../shared/contracts/workspace'
import { workspaceStateRoot } from './home'
import { UnreadableState } from './state-file'
import { statePath, writeJson } from './store'
import {
  emptyWorkspaceUiState,
  readWorkspaceUiState,
  updateWorkspaceUiState as updateOrRefuse,
} from './workspace-ui'

/** The state a patch leaves, failing the test when it is refused. */
function updateWorkspaceUiState(root: string, patch: unknown) {
  const updated = updateOrRefuse(root, patch)
  if ('problem' in updated) throw new Error(updated.problem)
  return updated.value
}

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
  })

  expect(saved).toMatchObject({
    version: 1,
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
  })
  expect(readWorkspaceUiState(alpha)).toEqual(saved)
  expect(readWorkspaceUiState(beta)).toEqual(emptyWorkspaceUiState())

  // what the state no longer holds (a section, the Domains a canvas drew) is not kept
  const patched = updateWorkspaceUiState(alpha, {
    section: 'tests',
    schema: { visibleDomainIds: ['orders'], initialized: true },
  })
  expect(patched).toEqual(saved)
  expect(Object.keys(patched)).not.toContain('section')
  expect(Object.keys(patched)).not.toContain('schema')

  // the reader scope can be cleared explicitly
  updateWorkspaceUiState(alpha, { readerDomainId: null })
  expect(readWorkspaceUiState(alpha).readerDomainId).toBeUndefined()
})

test('a state this Studio does not read whole is said as such, and no write goes over it', () => {
  const root = machineWorkspace('gamma')
  const path = statePath(root, 'ui.json')
  const newer = { version: 2, edgeStyle: 'dotted', panel: { open: true } }
  writeJson(root, 'ui.json', newer)
  const reason = 'it is version 2, and this Studio reads version 1'
  expect(() => readWorkspaceUiState(root)).toThrow(new UnreadableState(path, reason))
  expect(() => updateWorkspaceUiState(root, { edgeStyle: 'orthogonal' })).toThrow(UnreadableState)
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(newer)

  writeJson(root, 'ui.json', { version: 1, edgeStyle: 'dotted' })
  expect(() => readWorkspaceUiState(root)).toThrow(
    new UnreadableState(path, 'its edge style is none of curved, orthogonal'),
  )
  writeJson(root, 'ui.json', { version: 1, rail: { width: 'wide' } })
  expect(() => readWorkspaceUiState(root)).toThrow(
    new UnreadableState(path, 'its rail width is not a number'),
  )
})

test('a key this Studio does not know is kept, and a reader Domain id is bounded', () => {
  const root = machineWorkspace('delta')
  writeJson(root, 'ui.json', {
    ...emptyWorkspaceUiState(),
    section: 'tests',
    panel: { ...emptyWorkspaceUiState().panel, pinned: true },
  })
  updateWorkspaceUiState(root, { edgeStyle: 'orthogonal' })
  const written = JSON.parse(readFileSync(statePath(root, 'ui.json'), 'utf8'))
  expect(written.section).toBe('tests')
  expect(written.panel.pinned).toBe(true)
  expect(written.edgeStyle).toBe('orthogonal')

  const long = 'd'.repeat(WORKSPACE_UI_LIMITS.readerDomainId + 1)
  expect(updateOrRefuse(root, { readerDomainId: long })).toEqual({
    problem: `a reader Domain id is at most ${WORKSPACE_UI_LIMITS.readerDomainId} characters`,
    tooLarge: true,
  })
  expect(readWorkspaceUiState(root).readerDomainId).toBeUndefined()
})
