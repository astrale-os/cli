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

  // the order is the whole point: nothing can be attached or said to a domain
  // that does not exist yet
  expect(log).toEqual(['create:crm', 'upload:crm-id:2', 'submit:crm-id:Model invoices'])
  expect(phases).toEqual(['creating', 'attaching', 'briefing'])
  expect(outcome).toMatchObject({ id: 'crm-id', origin: 'crm.example.dev', run })
  expect(outcome.error).toBeUndefined()
})

test('a name with nothing asked of it creates nothing at all', async () => {
  const { log, ports: p } = ports()
  const outcome = await createDomainWithBrief(p, { name: 'crm', message: '   ', files: [] })

  // a scaffold nobody asked anything of is a folder, not a domain
  expect(log).toEqual([])
  expect(outcome.id).toBeUndefined()
  expect(outcome.error).toContain('what this domain is for')
})

test('files are not a request either — the message is', async () => {
  const { log, ports: p } = ports()
  const outcome = await createDomainWithBrief(p, {
    name: 'crm',
    message: '',
    files: [file('a.md')],
  })

  expect(log).toEqual([])
  expect(outcome.error).toContain('what this domain is for')
})

test('an invalid name never reaches the server', async () => {
  const { log, ports: p } = ports()
  const outcome = await createDomainWithBrief(p, { name: 'Not A Slug', message: 'go', files: [] })

  expect(log).toEqual([])
  expect(outcome.id).toBeUndefined()
  expect(outcome.error).toContain('lowercase')
})

test('a refused creation leaves nothing behind, and says why', async () => {
  const { log, ports: p } = ports({
    createDomain: async () => ({ ok: false, error: 'A folder named “crm” already exists.' }),
  })
  const outcome = await createDomainWithBrief(p, { name: 'crm', message: 'go', files: [] })

  // nothing was created, so nothing else was attempted — the composer keeps it all
  expect(log).toEqual([])
  expect(outcome.id).toBeUndefined()
  expect(outcome.unsent).toBeUndefined()
  expect(outcome.error).toContain('already exists')
})

test('a creation that throws is reported like any other refusal', async () => {
  const { ports: p } = ports({
    createDomain: async () => {
      throw new Error('502 /api/workspace/create')
    },
  })
  const outcome = await createDomainWithBrief(p, { name: 'crm', message: 'go', files: [] })

  expect(outcome.id).toBeUndefined()
  expect(outcome.error).toContain('502')
})

test('files that do not land hold the message back rather than brief a blind agent', async () => {
  const { log, ports: p } = ports({
    uploadDocuments: async () => {
      throw new Error('413 too large')
    },
  })
  const outcome = await createDomainWithBrief(p, {
    name: 'crm',
    message: 'read the spec',
    files: [file('spec.md')],
  })

  expect(log).toEqual(['create:crm'])
  // the domain exists — the caller opens it, carrying the message that never left
  expect(outcome.id).toBe('crm-id')
  expect(outcome.unsent).toBe('read the spec')
  expect(outcome.error).toContain('413')
})

test('a refused first turn hands the message back with the domain it belongs to', async () => {
  const { ports: p } = ports({
    submit: async () => ({ error: 'a turn is already running in this chat' }),
  })
  const outcome = await createDomainWithBrief(p, { name: 'crm', message: 'go', files: [] })

  expect(outcome).toMatchObject({
    id: 'crm-id',
    error: 'a turn is already running in this chat',
    unsent: 'go',
  })
  expect(outcome.run).toBeUndefined()
})
