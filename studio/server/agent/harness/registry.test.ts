import { expect, test } from 'bun:test'

import { AcpClaudeHarness } from './acp/claude'
import { AcpCodexHarness } from './acp/codex'
import { getHarnessById } from './registry'

test('the active Claude and Codex registry entries use ACP adapters', () => {
  expect(getHarnessById('claude')).toBeInstanceOf(AcpClaudeHarness)
  expect(getHarnessById('codex')).toBeInstanceOf(AcpCodexHarness)
})
