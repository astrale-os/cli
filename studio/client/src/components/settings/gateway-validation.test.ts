import { expect, test } from 'bun:test'

import { validateGatewayDraft } from './gateway-validation'

test('gateway drafts fail closed only when an enabled configuration is unsafe', () => {
  expect(validateGatewayDraft(false, '', 'token', '')).toBeNull()
  expect(validateGatewayDraft(true, '', 'mint', '')).toContain('required')
  expect(validateGatewayDraft(true, 'file:///tmp/gateway', 'mint', '')).toContain('http://')
  expect(validateGatewayDraft(true, 'not a url', 'mint', '')).toContain('valid URL')
  expect(validateGatewayDraft(true, 'https://gateway.example', 'token', '')).toContain(
    'bearer token',
  )
  expect(validateGatewayDraft(true, 'https://gateway.example', 'mint', '')).toBeNull()
})
