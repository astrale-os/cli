import type * as acp from '@agentclientprotocol/sdk'

import { expect, test } from 'bun:test'

import { fastConfig, fastEnabled, fastValue } from './options'

test('reads the ACP boolean fast-mode option advertised by a capable agent', () => {
  const option = {
    id: 'fast-mode',
    name: 'Fast mode',
    category: 'model_config',
    type: 'boolean',
    currentValue: false,
    description: '1.5x speed, increased usage',
  } satisfies acp.SessionConfigOption

  const config = fastConfig([option])!
  expect(fastEnabled(config)).toBe(false)
  expect(fastValue(config, true)).toBe(true)
})

test('supports the select fallback and never invents fast mode for an agent that omits it', () => {
  const option = {
    id: 'fast-mode',
    name: 'Fast mode',
    category: 'model_config',
    type: 'select',
    currentValue: 'on',
    options: [
      { value: 'off', name: 'Off' },
      { value: 'on', name: 'On' },
    ],
  } satisfies acp.SessionConfigOption

  const config = fastConfig([option])!
  expect(fastEnabled(config)).toBe(true)
  expect(fastValue(config, false)).toBe('off')
  expect(fastConfig([])).toBe(undefined)
})
