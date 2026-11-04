import { expect, test } from 'bun:test'

import { buildAskPrompt } from './ask'

test('an aside names the project it reads, or the Kernel the installed SDK ships', () => {
  const base = { anchorRef: 'class.Identity', excerpt: 'Identity', question: 'Who?', ir: null }
  expect(
    buildAskPrompt({ ...base, domain: { origin: 'crm.example.dev', path: 'domains/crm' } }),
  ).toContain('in the domain `crm.example.dev` (at `domains/crm`)')
  expect(buildAskPrompt({ ...base, domain: { origin: 'kernel.astrale.ai' } })).toContain(
    'in the read-only Kernel Domain `kernel.astrale.ai` (as the installed `@astrale-os/sdk` ships it)',
  )
  expect(buildAskPrompt(base)).toContain('in this workspace')
})
