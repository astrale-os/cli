import { expect, test } from 'bun:test'

import { updateAgentModel } from './agent-models'

test('switching model overrides preserves independent harness selections', () => {
  const selected = updateAgentModel({ claude: 'opus' }, 'Codex', ' gpt-5.4-mini ')
  expect(selected).toEqual({ claude: 'opus', codex: 'gpt-5.4-mini' })
  expect(updateAgentModel(selected, 'claude', '')).toEqual({ codex: 'gpt-5.4-mini' })
})
