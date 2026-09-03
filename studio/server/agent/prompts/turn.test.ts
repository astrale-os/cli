import { expect, test } from 'bun:test'

import type { DomainTurnParts } from './turn'

import { buildTurnPrompt } from './turn'

function domain(origin: string, relativePath: string): DomainTurnParts {
  return {
    origin,
    root: `/workspace/${relativePath.replace('./', '')}`,
    relativePath,
    renderFingerprint: '',
    openThreads: 0,
    awaitingThreads: [],
    userContext: [],
    autoContext: [],
    documents: [],
    ir: null,
  }
}

test('a creation turn explicitly binds the user brief to the freshly scaffolded domain', () => {
  const prompt = buildTurnPrompt({
    workspaceRoot: '/workspace',
    domains: [
      domain('existing.example.dev', './existing'),
      domain('billing.example.dev', './billing'),
    ],
    firstTurn: true,
    message: 'Model customers, invoices and payments.',
    newDomain: { id: 'billing', origin: 'billing.example.dev', path: './billing' },
  })

  expect(prompt).toContain('Domain Studio has just scaffolded the domain below')
  expect(prompt).toContain('## Newly created domain')
  expect(prompt).toContain('**Origin:** `billing.example.dev`')
  expect(prompt).toContain('**Repo:** `./billing`')
  expect(prompt).toContain('applies specifically to this domain')
  expect(prompt).toContain('follow its **New Domain Creation Workflow**')
  expect(prompt).toContain('## User creation brief\n\nModel customers, invoices and payments.')
  expect(prompt).toContain('**existing.example.dev**')
})

test('an ordinary first turn keeps the generic direct-instruction framing', () => {
  const prompt = buildTurnPrompt({
    workspaceRoot: '/workspace',
    domains: [domain('billing.example.dev', './billing')],
    firstTurn: true,
    message: 'Add payment reminders.',
  })

  expect(prompt).toContain('## Direct instruction')
  expect(prompt).not.toContain('## Newly created domain')
  expect(prompt).not.toContain('## User creation brief')
})
