import { describe, expect, test } from 'bun:test'

import { directInstallCallInput } from '../domain/install'

describe('directInstallCallInput', () => {
  test('sends the current remote Publication ensure request', () => {
    const operation = '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
    expect(directInstallCallInput('https://tasks.example.test', operation, 'secret')).toEqual({
      operation,
      domain: {
        publication: {
          url: 'https://tasks.example.test',
          token: 'secret',
        },
      },
    })
  })
})
