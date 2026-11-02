import { describe, expect, test } from 'bun:test'

import { checkFileContract, fileContract, injectAt, parseFileInput, schemaAt } from '../call-files'
import { acceptMediaType, inferMediaType, receiptRefused } from '../upload'

const code = (action: () => unknown) => {
  try {
    action()
  } catch (error) {
    return (error as { code?: string }).code
  }
  return undefined
}

describe('--file field parsing', () => {
  test('a top-level key is the JSON Pointer of that key', () => {
    expect(parseFileInput('balance=./tb.csv')).toEqual({ pointer: '/balance', path: './tb.csv' })
  })

  test('a JSON Pointer is kept, and the first = separates the field from the file', () => {
    expect(parseFileInput('/attachments/0=./a=b.pdf')).toEqual({
      pointer: '/attachments/0',
      path: './a=b.pdf',
    })
    expect(parseFileInput('/a~1b/-=f')).toEqual({ pointer: '/a~1b/-', path: 'f' })
  })

  test('refuses a spec without a field or a file, a dotted key or a broken pointer', () => {
    for (const spec of ['balance', '=./f', 'balance=', 'a.b=./f', '/a~2=./f']) {
      expect(code(() => parseFileInput(spec))).toBe('FILE_INPUT_INVALID')
    }
  })
})

describe('receipt injection', () => {
  test('writes at a key, creating objects and arrays on the way', () => {
    const input: Record<string, unknown> = { fiscalYear: '2026' }
    injectAt(input, '/balance', 'r1')
    injectAt(input, '/attachments/0', 'r2')
    injectAt(input, '/attachments/-', 'r3')
    injectAt(input, '/meta/source/file', 'r4')
    injectAt(input, '/a~1b', 'r5')
    expect(input).toEqual({
      fiscalYear: '2026',
      balance: 'r1',
      attachments: ['r2', 'r3'],
      meta: { source: { file: 'r4' } },
      'a/b': 'r5',
    })
  })

  test('fills an existing array and nested object', () => {
    const input: Record<string, unknown> = { operations: [{ kind: 'create', props: {} }] }
    injectAt(input, '/operations/0/props/content', 'r1')
    expect(input).toEqual({ operations: [{ kind: 'create', props: { content: 'r1' } }] })
  })

  test('never replaces a value, nor skips array positions', () => {
    expect(code(() => injectAt({ balance: 'x' }, '/balance', 'r'))).toBe('FILE_INPUT_CONFLICT')
    expect(code(() => injectAt({ items: [] }, '/items/1', 'r'))).toBe('FILE_INPUT_CONFLICT')
    expect(code(() => injectAt({ items: ['a'] }, '/items/0', 'r'))).toBe('FILE_INPUT_CONFLICT')
    expect(code(() => injectAt({ items: [] }, '/items/name', 'r'))).toBe('FILE_INPUT_CONFLICT')
    expect(code(() => injectAt({ year: 2026 }, '/year/file', 'r'))).toBe('FILE_INPUT_CONFLICT')
  })
})

describe('declared file fields', () => {
  const input = {
    type: 'object',
    properties: {
      fiscalYear: { type: 'string' },
      balance: {
        type: 'string',
        'x-astrale-value-kind': 'file',
        'x-astrale-file': { maxBytes: 10, mediaTypes: ['text/csv'] },
      },
      attachments: {
        type: 'array',
        items: { type: 'string', 'x-astrale-value-kind': 'file' },
      },
    },
  }
  const csv = (size: number, mediaType = 'text/csv') => ({ path: 'tb.csv', size, mediaType })

  test('reads the file marker the input declares at a pointer', () => {
    expect(fileContract(schemaAt(input, '/balance'))).toEqual({
      maxBytes: 10,
      mediaTypes: ['text/csv'],
    })
    expect(fileContract(schemaAt(input, '/attachments/3'))).toEqual({})
    expect(fileContract(schemaAt(input, '/attachments/-'))).toEqual({})
  })

  test('a plain string field, an unknown field or no schema declares nothing', () => {
    expect(fileContract(schemaAt(input, '/fiscalYear'))).toBeUndefined()
    expect(fileContract(schemaAt(input, '/other'))).toBeUndefined()
    expect(fileContract(schemaAt(undefined, '/balance'))).toBeUndefined()
  })

  test('refuses a file over the field bound or of another media type', () => {
    const contract = fileContract(schemaAt(input, '/balance'))
    expect(code(() => checkFileContract('/balance', csv(11), contract))).toBe('FILE_TOO_LARGE')
    expect(code(() => checkFileContract('/balance', csv(5, 'application/pdf'), contract))).toBe(
      'FILE_MEDIA_TYPE_REFUSED',
    )
    expect(code(() => checkFileContract('/balance', csv(10), contract))).toBeUndefined()
    expect(code(() => checkFileContract('/balance', csv(10 ** 9), undefined))).toBeUndefined()
  })

  test('a type/* entry admits that type', () => {
    const contract = { mediaTypes: ['image/*'] }
    expect(code(() => checkFileContract('/scan', csv(1, 'image/png'), contract))).toBeUndefined()
    expect(code(() => checkFileContract('/scan', csv(1, 'text/csv'), contract))).toBe(
      'FILE_MEDIA_TYPE_REFUSED',
    )
  })
})

describe('media types', () => {
  test('follow the extension, without parameters, and default to octet-stream', () => {
    expect(inferMediaType('a/Balance.CSV')).toBe('text/csv')
    expect(inferMediaType('report.pdf')).toBe('application/pdf')
    expect(inferMediaType('photo.jpeg')).toBe('image/jpeg')
    expect(inferMediaType('data.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(inferMediaType('README')).toBe('application/octet-stream')
    expect(inferMediaType('archive.unknown')).toBe('application/octet-stream')
  })

  test('an explicit one is canonicalized or refused', () => {
    expect(acceptMediaType('Text/CSV; Charset=utf-8')).toBe('text/csv;charset=utf-8')
    for (const invalid of ['csv', 'text/', 'a/b/c', 'text/csv;charset']) {
      expect(code(() => acceptMediaType(invalid))).toBe('MEDIA_TYPE_INVALID')
    }
  })
})

describe('refused receipts', () => {
  test('are recognized at any depth of a Kernel reason', () => {
    expect(receiptRefused({ code: 'BLOB_RECEIPT_INVALID' })).toBe(true)
    expect(
      receiptRefused({
        code: 'FUNCTION_INPUT_INVALID',
        details: { code: 'MUTATION_BLOB_RECEIPT_INVALID' },
      }),
    ).toBe(true)
    expect(receiptRefused({ code: 'FUNCTION_INPUT_INVALID', details: { issues: [] } })).toBe(false)
    expect(receiptRefused(undefined)).toBe(false)
  })
})
