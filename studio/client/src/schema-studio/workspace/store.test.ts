import { expect, test } from 'bun:test'

import { selectionForActiveDomain, uniqueDomainIds, useSchemaWorkspace } from './store'

test('normalizes workspace domain selections without reordering them', () => {
  expect(uniqueDomainIds(['services', 'kernel', 'services', '', 'shell'])).toEqual([
    'services',
    'kernel',
    'shell',
  ])
})

test('switches a single-domain canvas without accidentally enabling composition', () => {
  expect(selectionForActiveDomain(['services'], 'services', 'issues')).toEqual(['issues'])
})

test('keeps a composed canvas while changing or adding its active domain', () => {
  expect(selectionForActiveDomain(['services', 'issues'], 'services', 'issues')).toEqual([
    'services',
    'issues',
  ])
  expect(selectionForActiveDomain(['services', 'issues'], 'services', 'shell')).toEqual([
    'services',
    'issues',
    'shell',
  ])
})

test('resets domain and external frame geometry as one workspace layout', () => {
  const before = useSchemaWorkspace.getState()
  useSchemaWorkspace.setState({
    domainPositions: { issues: { x: 20, y: 30 } },
    externalPositions: { 'kernel.astrale.ai': { x: 600, y: 40 } },
  })

  try {
    useSchemaWorkspace.getState().resetWorkspaceFrames()
    const reset = useSchemaWorkspace.getState()
    expect(reset.domainPositions).toEqual({})
    expect(reset.externalPositions).toEqual({})
  } finally {
    useSchemaWorkspace.setState({
      selectedDomainIds: before.selectedDomainIds,
      domainPositions: before.domainPositions,
      externalPositions: before.externalPositions,
      collapsedModules: before.collapsedModules,
    })
  }
})

test('remembers where an external frame was dropped, under its origin', () => {
  const before = useSchemaWorkspace.getState()
  useSchemaWorkspace.setState({ externalPositions: { 'kernel.astrale.ai': { x: 600, y: 40 } } })

  try {
    useSchemaWorkspace.getState().setExternalPosition('remote.astrale.ai', { x: 812, y: 96 })
    expect(useSchemaWorkspace.getState().externalPositions).toEqual({
      'kernel.astrale.ai': { x: 600, y: 40 },
      'remote.astrale.ai': { x: 812, y: 96 },
    })
  } finally {
    useSchemaWorkspace.setState({ externalPositions: before.externalPositions })
  }
})
