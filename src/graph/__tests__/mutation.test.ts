import { describe, expect, test } from 'bun:test'

import { prepareMutation } from '../mutation'

describe('prepareMutation', () => {
  /** @evidence TEST-CLI-GRAPH-ADMITS-MUTATION-V3 */
  test('creates one canonical Mutation V3 document from exact authoring input', () => {
    expect(
      JSON.parse(
        JSON.stringify(
          prepareMutation({
            preconditions: [],
            operations: [
              {
                op: 'node.create',
                as: 'note',
                class: '/:notes.example.dev:class.Note',
                props: {},
              },
            ],
          }),
        ),
      ),
    ).toEqual({
      format: 'astrale.graph.mutation',
      version: 'v3',
      preconditions: [],
      operations: [
        {
          op: 'node.create',
          as: 'note',
          class: '/:notes.example.dev:class.Note',
          props: {},
        },
      ],
    })
  })

  /** @evidence TEST-CLI-GRAPH-REJECTS-PATCH-DATA */
  test('rejects legacy PatchData instead of narrowing it', () => {
    expect(() => prepareMutation({ nodes: { create: [] }, edges: { create: [] } })).toThrow()
  })
})
