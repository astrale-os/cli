import { expect, test } from 'bun:test'

import { serving, viewConfig } from '../../lib/__tests__/view.fixture'
import { waitForPageState } from '../view'

test.each(['refreshing', 'degraded', 'expired'])(
  'opening observes recoverable %s without treating the mounted page as failed',
  async (state) => {
    const config = viewConfig('page-state', { handshake: 'none', kernel: {} })
    await serving(config, {}, async (session, server) => {
      const response = await fetch(`${session}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state, page: 'viewer' }),
      })
      expect(response.status).toBe(200)
      const result = await waitForPageState({ ...config.session, pageUrl: `${session}/` })
      expect(result.state).toBe(state)
      expect(server.listening).toBe(true)
    })
  },
)
