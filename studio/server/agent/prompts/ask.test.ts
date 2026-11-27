import { expect, test } from 'bun:test'

import { buildAskPrompt } from './ask'

test('an aside names the project it reads, the Kernel the installed SDK ships, or a Publication', () => {
  const base = { anchorRef: 'class.Identity', excerpt: 'Identity', question: 'Who?', ir: null }
  const project = buildAskPrompt({
    ...base,
    domain: { source: 'project', origin: 'crm.example.dev', path: 'domains/crm' },
  })
  expect(project).toContain('in the domain `crm.example.dev` (at `domains/crm`)')
  expect(project).not.toContain('never edited')
  const kernel = buildAskPrompt({
    ...base,
    domain: { source: 'kernel', origin: 'kernel.astrale.ai' },
    readOnly: true,
  })
  expect(kernel).toContain(
    'in the read-only Kernel Domain `kernel.astrale.ai` (as the installed `@astrale-os/sdk` ships it)',
  )
  expect(kernel).toContain('change no file for it')
  const publication = buildAskPrompt({
    ...base,
    domain: { source: 'publication', origin: 'issues.astrale.ai', version: '0.9.0' },
    readOnly: true,
  })
  expect(publication).toContain('in the read-only Publication `issues.astrale.ai@0.9.0`')
  expect(publication).toContain('change no file for it')
  expect(buildAskPrompt(base)).toContain('in this workspace')
})
