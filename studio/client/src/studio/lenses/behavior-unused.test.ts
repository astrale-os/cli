import { describe, expect, test } from 'bun:test'

import { behaviorBundle, publishedBehaviorBundle } from './__tests__/behavior-fixture'
import { behaviorFocus, behaviorModel, projectBehavior } from './behavior'

const UNUSED = 'mutation.unused.drop'

describe('a mutation no function uses', () => {
  const bundle = behaviorBundle()

  test('is the Domain’s all the same: the model holds it and names it unused', () => {
    const model = behaviorModel(bundle)
    expect(model.mutations.has(UNUSED)).toBe(true)
    expect(model.unused).toEqual([UNUSED])
  })

  test('is listed with the mutations, saying no function uses it', () => {
    const entry = projectBehavior(bundle, {}).index?.entries.find((one) => one.id === UNUSED)
    expect(entry).toMatchObject({ kind: 'mutation', sublabel: 'no function uses it' })
  })

  test('is not drawn at rest, where mutations fold into the functions that use them', () => {
    const scene = projectBehavior(bundle, {})
    expect(scene.nodes.some((node) => node.id === UNUSED)).toBe(false)
  })

  test('stands in the mutations’ column with what it changes, and nothing leading to it', () => {
    for (const scene of [
      projectBehavior(bundle, { mutations: true }),
      projectBehavior(bundle, {}, behaviorFocus(bundle, {}, UNUSED)),
    ]) {
      const node = scene.nodes.find((one) => one.id === UNUSED)
      expect(node).toMatchObject({ kind: 'mutation', sublabel: 'no function uses it' })
      expect(scene.links.some((link) => link.to.nodes.includes(UNUSED))).toBe(false)
      expect(
        scene.links
          .filter((link) => link.from.nodes.includes(UNUSED))
          .map((link) => [link.kind, link.to.nodes]),
      ).toEqual([['change', ['class.Note']]])
    }
  })

  test('is not told of a bundle with no handler sources, where use cannot be read', () => {
    expect(behaviorModel(publishedBehaviorBundle()).unused).toEqual([])
  })
})
