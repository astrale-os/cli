import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EDGE_ARROW, EdgeMarkerDefs } from './edge-markers'

test('the arrow tip is aligned with the edge endpoint on the node border', () => {
  const markup = renderToStaticMarkup(<EdgeMarkerDefs />)

  expect(markup).toContain(`id="${EDGE_ARROW}"`)
  expect(markup).toContain('refX="10.5"')
  expect(markup).toContain('d="M4 2.5 L10.5 6 L4 9.5"')
})
