import { expect, test } from 'bun:test'

import {
  hydrateSchemaWorkspace,
  schemaWorkspaceSnapshot,
  uniqueDomainIds,
  useSchemaWorkspace,
} from './store'

test('normalizes workspace domain selections without reordering them', () => {
  expect(uniqueDomainIds(['services', 'kernel', 'services', '', 'shell'])).toEqual([
    'services',
    'kernel',
    'shell',
  ])
})

test('the eye toggle is the sole canvas-membership control', () => {
  const before = schemaWorkspaceSnapshot()
  try {
    hydrateSchemaWorkspace({
      visibleDomainIds: ['services'],
      initialized: true,
      domainPositions: {},
      externalPositions: {},
      collapsedModules: {},
      expandedDomainIds: [],
      expandedExternals: [],
    })
    useSchemaWorkspace.getState().toggleDomain('issues')
    expect(useSchemaWorkspace.getState().visibleDomainIds).toEqual(['services', 'issues'])
    useSchemaWorkspace.getState().toggleDomain('services')
    expect(useSchemaWorkspace.getState().visibleDomainIds).toEqual(['issues'])
  } finally {
    hydrateSchemaWorkspace(before)
  }
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
      visibleDomainIds: before.visibleDomainIds,
      domainPositions: before.domainPositions,
      externalPositions: before.externalPositions,
      collapsedModules: before.collapsedModules,
      initialized: before.initialized,
      expandedDomainIds: before.expandedDomainIds,
      expandedExternals: before.expandedExternals,
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
    hydrateSchemaWorkspace(before)
  }
})
