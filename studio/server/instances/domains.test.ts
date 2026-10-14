import { expect, test } from 'bun:test'

import { decodeInstalled } from './domains'

test('the installed list keeps what Studio shows of each Domain and drops anything malformed', () => {
  expect(
    decodeInstalled({
      format: 'astrale.installed-list',
      version: 1,
      kernel: 'https://mine.eu.astrale.ai/api',
      partial: true,
      domains: [
        {
          origin: 'crm.astrale.ai',
          revision: 'r1',
          issuer: 'https://issuer.example',
          url: 'https://crm-1-4-0.services.example',
          pin: { kind: 'release' },
          version: '1.4.0',
          name: '1.4.0',
          available: '1.5.0',
        },
        { origin: 'notes.astrale.ai', name: 'local', pin: { kind: 'artifact' } },
        { origin: 'broken.astrale.ai' },
      ],
    }),
  ).toEqual([
    {
      origin: 'crm.astrale.ai',
      name: '1.4.0',
      version: '1.4.0',
      url: 'https://crm-1-4-0.services.example',
      available: '1.5.0',
    },
    { origin: 'notes.astrale.ai', name: 'local' },
  ])
  expect(decodeInstalled({ format: 'something-else', domains: [] })).toBeUndefined()
  expect(decodeInstalled('not json')).toBeUndefined()
})
