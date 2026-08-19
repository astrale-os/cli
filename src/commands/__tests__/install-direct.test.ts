import { describe, expect, test } from 'bun:test'

import { directInstallCallInput } from '../domain/install'

describe('directInstallCallInput', () => {
  test('sends the current remote install syscall, not a legacy url list', () => {
    expect(directInstallCallInput('https://tasks.example.test', 'secret', 'op-1')).toEqual({
      operation: 'op-1',
      domains: [
        {
          source: {
            kind: 'remote',
            url: 'https://tasks.example.test',
            token: 'secret',
          },
        },
      ],
    })
  })
})
