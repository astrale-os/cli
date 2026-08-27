import { expect, test } from 'bun:test'

import { documentResponseHeaders } from './documents'

test('an uploaded document can never execute on the studio origin', () => {
  // the uploader picks the stored MIME type, and this origin drives a local agent
  const html = documentResponseHeaders('text/html;charset=utf-8', 'notes.html')

  expect(html['content-type']).toBe('application/octet-stream')
  expect(html['content-disposition']).toBe("attachment; filename*=UTF-8''notes.html")
  expect(html['x-content-type-options']).toBe('nosniff')
  expect(documentResponseHeaders('image/svg+xml', 'logo.svg')['content-type']).toBe(
    'application/octet-stream',
  )
})

test('documents that only ever render as data stay inline', () => {
  const markdown = documentResponseHeaders('text/markdown;charset=utf-8', 'pricing.md')

  expect(markdown['content-type']).toBe('text/markdown;charset=utf-8')
  expect(markdown['content-disposition']).toBe('inline')
  expect(documentResponseHeaders('application/pdf', 'quote.pdf')['content-disposition']).toBe(
    'inline',
  )
})

test('a download name survives spaces and non-ascii', () => {
  expect(documentResponseHeaders('application/zip', 'Décisions tarifaires.zip')).toMatchObject({
    'content-disposition': "attachment; filename*=UTF-8''D%C3%A9cisions%20tarifaires.zip",
  })
})
