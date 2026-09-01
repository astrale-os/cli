import { expect, test } from 'bun:test'

import {
  migrateSelection,
  selectionForActiveDomain,
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

test('switches a single-domain canvas without accidentally enabling composition', () => {
  expect(selectionForActiveDomain(['services'], 'issues')).toEqual(['issues'])
})

test('keeps a composed canvas while changing or adding its active domain', () => {
  expect(selectionForActiveDomain(['services', 'issues'], 'issues')).toEqual(['services', 'issues'])
  expect(selectionForActiveDomain(['services', 'issues'], 'shell')).toEqual([
    'services',
    'issues',
    'shell',
  ])
})

test('an empty canvas draws the domain you go and work in', () => {
  expect(selectionForActiveDomain([], 'issues')).toEqual(['issues'])
})

test('a domain taken off the canvas is not put back by working elsewhere', () => {
  expect(selectionForActiveDomain(['issues', 'shell'], 'issues')).toEqual(['issues', 'shell'])
})

test('upgrading a two-list canvas keeps drawing exactly what was on screen', () => {
  expect(
    migrateSelection({
      selectedDomainIds: ['services', 'issues', 'shell'],
      hiddenDomainIds: ['issues'],
    }),
  ).toEqual(['services', 'shell'])
  expect(migrateSelection({ selectedDomainIds: ['services'] })).toEqual(['services'])
  expect(migrateSelection({})).toEqual([])
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
