import { describe, expect, test } from 'bun:test'

import { nodeProperty, unqualifyProperty } from '../projection'

describe('graph presentation properties', () => {
  /** @evidence TEST-CLI-GRAPH-PROJECTS-QUALIFIED-PROPERTIES */
  test('prefers exact keys and otherwise projects a qualified leaf', () => {
    const node = {
      props: {
        name: 'exact',
        '/:example.test:class.Widget.property.name': 'qualified',
        '/:example.test:class.Widget.property.description': 'shown',
      },
    }

    expect(nodeProperty(node, 'name')).toBe('exact')
    expect(nodeProperty(node, 'description')).toBe('shown')
    expect(unqualifyProperty('/:example.test:class.Widget.property.description')).toBe(
      'description',
    )
  })
})
