import { describe, expect, test } from 'bun:test'

import { bundle, classRef, edgeClass, nodeClass } from './__tests__/fixture'
import { crossDomainEdges, externalDomains, localEndpointTargets } from './external'

describe('external Class projection', () => {
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
    fixture.ir!.importsByKey = {
      'remote.example.dev:class.Remote': {
        origin: remote.origin,
        ref: remote,
        key: 'remote.example.dev:class.Remote',
      },
    }
    fixture.ir!.importedClassesByKey = {
      'remote.example.dev:class.Remote': nodeClass('Remote', {
        origin: remote.origin,
        ref: remote,
      }),
    }

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
        members: [{ name: 'Remote', ref: remote }],
      },
    ])
  })

  test('does not infer an import from a short-name collision', () => {
    const fixture = bundle({ User: nodeClass('User') })
    fixture.ir!.importsByKey = {
      'remote.example.dev:class.User': {
        origin: 'remote.example.dev',
        ref: classRef('remote.example.dev', 'User'),
        key: 'remote.example.dev:class.User',
      },
    }
    expect(localEndpointTargets(fixture.ir!, { types: ['User'] })).toEqual([{ className: 'User' }])
  })
})
