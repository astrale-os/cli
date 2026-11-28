import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { datasetRequest, NoDataset } from './no-dataset'

test('a Domain with no Dataset says what one is, where it is declared, and offers the request', () => {
  const html = renderToStaticMarkup(<NoDataset onAsk={() => {}} />)
  expect(html).toContain('No Dataset referenced')
  expect(html).toContain(
    'A Dataset is a small graph of Nodes and Edges, written in code, that the Data level asks through Queries and decides access on.',
  )
  expect(html).toContain('tests/datasets/&lt;name&gt;.ts')
  expect(html).toContain('@astrale-os/sdk/testing')
  expect(html).toContain('astrale.config.ts')
  expect(html).toContain('data-action="ask-dataset"')
  // a read-only Domain is told the same, and offered no request to write into it
  const readOnly = renderToStaticMarkup(<NoDataset />)
  expect(readOnly).toContain('A Dataset is a small graph of Nodes and Edges')
  expect(readOnly).not.toContain('data-action="ask-dataset"')
})

test('the request names the Domain, the declaration the Studio reads, and what it must not change', () => {
  const request = datasetRequest('ops.studio-demo.astrale.ai')
  expect(request.startsWith('Write a demo Dataset for the ops.studio-demo.astrale.ai Domain')).toBe(
    true,
  )
  expect(request).toContain('defineDataset(schema, { id, title, description, graph })')
  expect(request).toContain("dataset('./tests/datasets/<name>.ts')")
  expect(request).toContain('Change nothing else: not the Schema, the Policies or the functions.')
})
