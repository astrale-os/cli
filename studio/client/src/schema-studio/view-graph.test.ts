import { expect, test } from 'bun:test'

import { buildViewsModel } from '@/lib/views'

import { anatomy, bundle, nodeClass } from './__tests__/fixture'
import { viewGraph, viewGraphKey } from './view-graph'

const board = { slug: 'board', kind: 'spa', mount: '/ui/board' } as const
const about = { slug: 'about', kind: 'inline-html' } as const

test('every view is a node of its Domain, and the rebuild key moves only with the views', () => {
  const source = bundle({ Issue: nodeClass('Issue') })
  const { nodes, edges } = viewGraph(buildViewsModel(anatomy([board, about]), source), source)
  expect(nodes.map((node) => [node.id, node.type])).toEqual([
    ['view.board', 'viewNode'],
    ['view.about', 'viewNode'],
  ])
  expect(edges).toEqual([])

  const base = viewGraphKey(buildViewsModel(anatomy([board]), source))
  expect(viewGraphKey(buildViewsModel(anatomy([board]), source))).toBe(base)
  expect(viewGraphKey(buildViewsModel(anatomy([board, about]), source))).not.toBe(base)
})
