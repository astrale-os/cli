import { describe, expect, test } from 'bun:test'

import { prepareMutation } from '../mutation'

describe('prepareMutation', () => {
  /** @evidence TEST-CLI-GRAPH-ADMITS-MUTATION-V2 */
  test('creates one canonical Mutation V2 document from exact authoring input', () => {
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
      version: 'v2',
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
