import { describe, expect, test } from 'bun:test'

import { admitExternalOpenOrigins } from '../view/external-open-origins'

describe('View external navigation grants', () => {
  test('defaults to no authority and canonicalizes exact HTTPS origins', () => {
    expect(admitExternalOpenOrigins(undefined)).toEqual([])
    expect(
      admitExternalOpenOrigins([
        'https://connect.nango.dev',
        'https://connect.nango.dev/',
        'https://connect.composio.dev:443',
      ]),
    ).toEqual(['https://connect.nango.dev', 'https://connect.composio.dev'])
  })

  test.each([
    'http://connect.nango.dev',
    'https://user@connect.nango.dev',
    'https://connect.nango.dev/path',
    'https://connect.nango.dev?session=secret',
    'https://*.example.com',
    'not-a-url',
  ])('rejects a non-origin grant: %s', (candidate) => {
    expect(() => admitExternalOpenOrigins([candidate])).toThrow('exact HTTPS origin')
  })
})
