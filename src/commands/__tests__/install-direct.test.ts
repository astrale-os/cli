import { acceptOperationId } from '@astrale-os/kernel-client/schema'
import { describe, expect, test } from 'bun:test'

import { directInstallCallInput } from '../domain/install'

describe('directInstallCallInput', () => {
  test('sends the current remote install syscall, not a legacy url list', () => {
    const operation = acceptOperationId('4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8')
    expect(directInstallCallInput('https://tasks.example.test', operation, 'secret')).toEqual({
      operation,
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
