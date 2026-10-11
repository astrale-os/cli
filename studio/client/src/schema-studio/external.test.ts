import { expect, test } from 'bun:test'

import { bundle, classRef, edgeClass, importClass, nodeClass } from './__tests__/fixture'
import { crossDomainEdges, externalDomains, localEndpointTargets } from './external'

test('projects only local node endpoints as local targets', () => {
  const fixture = bundle({ User: nodeClass('User') })
  expect(
    localEndpointTargets(fixture.ir!, {
      types: ['User', 'Remote'],
      refs: [classRef('local.example.dev', 'User'), classRef('remote.example.dev', 'Remote')],
    }),
  ).toEqual([{ className: 'User' }])
})

test('retains exact external Class identity and cardinality on cross-domain edges', () => {
  const remote = classRef('remote.example.dev', 'Remote')
  const fixture = bundle({
    User: nodeClass('User'),
    assigned_to: edgeClass('assigned_to', [
      {
        name: 'user',
        types: ['User'],
        refs: [classRef('local.example.dev', 'User')],
        cardinality: { min: 1, max: 1 },
      },
      {
        name: 'target',
        types: ['Remote'],
        refs: [remote],
        cardinality: { min: 0, max: null },
      },
    ]),
  })
  importClass(fixture, remote, nodeClass('Remote', { origin: remote.origin, ref: remote }))

  expect(crossDomainEdges(fixture)).toEqual([
    expect.objectContaining({
      edge: 'assigned_to',
      from: 'User',
      origin: 'remote.example.dev',
      to: 'Remote',
      toRef: remote,
      fromCard: { min: 1, max: 1 },
      toCard: { min: 0, max: null },
    }),
  ])
  expect(externalDomains(fixture)).toEqual([
    {
      origin: 'remote.example.dev',
      kind: 'external',
      members: [{ name: 'Remote', ref: remote, connected: true }],
    },
  ])
})

test('lists an imported Class nothing links as unconnected, and an imported edge not at all', () => {
  const settings = classRef('config.example.dev', 'Settings')
  const link = classRef('rel.example.dev', 'links_to')
  const fixture = bundle({ User: nodeClass('User') })
  importClass(fixture, settings, nodeClass('Settings', { origin: settings.origin, ref: settings }))
  // an imported edge is the line it draws, not a member to list
  importClass(fixture, link, edgeClass('links_to', [{ name: 'from', types: ['User'] }]))
  expect(externalDomains(fixture)).toEqual([
    {
      origin: 'config.example.dev',
      kind: 'external',
      members: [{ name: 'Settings', ref: settings, connected: undefined }],
    },
  ])
})

test('does not infer an import from a short-name collision', () => {
  const fixture = bundle({ User: nodeClass('User') })
  importClass(fixture, classRef('remote.example.dev', 'User'))
  expect(localEndpointTargets(fixture.ir!, { types: ['User'] })).toEqual([{ className: 'User' }])
})
