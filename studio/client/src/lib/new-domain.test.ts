import type { AgentRun } from '@shared/types'

import { expect, test } from 'bun:test'

import {
  createDomainWithBrief,
  type NewDomainPhase,
  type NewDomainPorts,
  readName,
} from './new-domain'

const run = { id: 'run-1', chatId: 'chat-1', status: 'running', events: [] } as unknown as AgentRun
const file = (name: string) => new File(['hello'], name, { type: 'text/markdown' })

/** Every port records what it was called with, in the order the flow called it. */
function ports(overrides: Partial<NewDomainPorts> = {}) {
  const log: string[] = []
  const phases: NewDomainPhase[] = []
  const base: NewDomainPorts = {
    createDomain: async (name) => {
      log.push(`create:${name}`)
      return { ok: true, id: `${name}-id`, origin: `${name}.example.dev` }
    },
    uploadDocuments: async (id, files) => {
      log.push(`upload:${id}:${files.length}`)
      return []
    },
    submit: async (id, message) => {
      log.push(`submit:${id}:${message}`)
      return { run }
    },
    onPhase: (phase) => phases.push(phase),
  }
  return { log, phases, ports: { ...base, ...overrides } }
}

test('a name is read as a slug, and as what is wrong with it', () => {
  expect(readName('  CRM  ')).toEqual({ slug: 'crm', valid: true, error: null })
  expect(readName('crm.acme.dev')).toMatchObject({ valid: true, error: null })
  // nothing typed is not an error yet, it is just nothing
  expect(readName('   ')).toEqual({ slug: '', valid: false, error: null })
  expect(readName('Crm Acme!').error).toContain('lowercase')
  expect(readName('x'.repeat(65)).error).toContain('64')
})

test('the domain is created, then given its files, then given the message', async () => {
  const { log, phases, ports: p } = ports()
  const outcome = await createDomainWithBrief(p, {
    name: 'crm',
    message: '  Model invoices  ',
    files: [file('spec.md'), file('notes.md')],
  })
  expect(log).toEqual(['create:crm', 'upload:crm-id:2', 'submit:crm-id:Model invoices'])
  expect(phases).toEqual(['creating', 'attaching', 'briefing'])
  expect(outcome).toMatchObject({ id: 'crm-id', origin: 'crm.example.dev', run })
  expect(outcome.error).toBeUndefined()
})

test('nothing is created without a message, a valid name and a creation that succeeds', async () => {
  const refusals: [
    Partial<NewDomainPorts>,
    { name: string; message: string; files: File[] },
    string,
  ][] = [
    [{}, { name: 'crm', message: '   ', files: [] }, 'what this domain is for'],
    [{}, { name: 'crm', message: '', files: [file('a.md')] }, 'what this domain is for'],
    [{}, { name: 'Not A Slug', message: 'go', files: [] }, 'lowercase'],
    [
      { createDomain: async () => ({ ok: false, error: 'A folder named “crm” already exists.' }) },
      { name: 'crm', message: 'go', files: [] },
      'already exists',
    ],
    [
      {
        createDomain: async () => {
          throw new Error('502 /api/workspace/create')
        },
      },
      { name: 'crm', message: 'go', files: [] },
      '502',
    ],
  ]
  for (const [overrides, input, error] of refusals) {
    const { log, ports: p } = ports(overrides)
    const outcome = await createDomainWithBrief(p, input)
    expect(log).toEqual([])
    expect(outcome.id).toBeUndefined()
    expect(outcome.unsent).toBeUndefined()
    expect(outcome.error).toContain(error)
  }
})

test('once the domain exists, a failed upload or first turn hands the message back', async () => {
  const upload = ports({
    uploadDocuments: async () => {
      throw new Error('413 too large')
    },
  })
  const held = await createDomainWithBrief(upload.ports, {
    name: 'crm',
    message: 'read the spec',
    files: [file('spec.md')],
  })
  // files that do not land hold the message back rather than brief a blind agent
  expect(upload.log).toEqual(['create:crm'])
  expect(held).toMatchObject({ id: 'crm-id', unsent: 'read the spec' })
  expect(held.error).toContain('413')

  const refused = await createDomainWithBrief(
    ports({ submit: async () => ({ error: 'a turn is already running in this chat' }) }).ports,
    { name: 'crm', message: 'go', files: [] },
  )
  expect(refused).toMatchObject({
    id: 'crm-id',
    error: 'a turn is already running in this chat',
    unsent: 'go',
  })
  expect(refused.run).toBeUndefined()
})
