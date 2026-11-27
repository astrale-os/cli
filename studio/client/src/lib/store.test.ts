import { publishedDomainId } from '@shared/contracts/versions'
import { expect, test } from 'bun:test'

import { agentDraftOf, shownDomainId, uiWorkspaceSnapshot, useUI } from './store'

test('clearing the selection closes the detail it opened, and leaves an overlay panel alone', () => {
  useUI.getState().selectClass('class.Monitor', 'ops')
  expect(useUI.getState().focusId).toBe('class.Monitor')
  useUI.getState().clearSelection()
  expect(useUI.getState().selectedClass).toBeUndefined()
  expect(useUI.getState().focusId).toBeNull()

  useUI.getState().setPanelOverlay('views')
  useUI.getState().clearSelection()
  expect(useUI.getState().panelOverlay).toEqual({ kind: 'views' })
})

test('revealing a relationship asks the canvas for the LINE, and pins no focus on it', () => {
  // focus fades what a NODE is not wired to: pinned on a relationship it would fade everything
  for (const ref of ['edge.SubscribedTo', 'edge.SubscribedTo.endpoint.customer']) {
    useUI.getState().revealAnchor(ref, 'crm')
    expect(useUI.getState()).toMatchObject({
      selectedClass: 'class.SubscribedTo',
      focusId: null,
      revealTarget: 'edge.SubscribedTo',
      revealedRef: ref,
    })
  }
  useUI.getState().revealAnchor('class.Company', 'crm')
  expect(useUI.getState()).toMatchObject({
    focusId: 'class.Company',
    revealTarget: 'class.Company',
  })
})

test('what was typed before the chat list landed goes to the first chat, once', () => {
  useUI.setState({ agentDrafts: {} })
  const drafts = () => useUI.getState().agentDrafts
  useUI.getState().setAgentDraft(undefined, 'add a Payment class')
  useUI.getState().setAgentDraft('chat-b', 'the real message')

  // never written over a chat already being written to
  useUI.getState().adoptAgentDraft('chat-b')
  expect(agentDraftOf(drafts(), 'chat-b')).toBe('the real message')
  // handed over, not copied: the next chat does not inherit it too
  useUI.getState().adoptAgentDraft('chat-a')
  expect(agentDraftOf(drafts(), 'chat-a')).toBe('add a Payment class')
  expect(agentDraftOf(drafts(), undefined)).toBe('')
  useUI.getState().adoptAgentDraft('chat-c')
  expect(agentDraftOf(drafts(), 'chat-c')).toBe('')
})

test('a dataset belongs to its Domain', () => {
  useUI.getState().setReaderDomain('issues')
  useUI.getState().openDataLevel('./tests/datasets/triage.ts')
  expect(useUI.getState()).toMatchObject({
    level: 'data',
    dataset: './tests/datasets/triage.ts',
  })

  // the same Domain keeps it; another one starts on its own first dataset
  useUI.getState().setReaderDomain('issues')
  expect(useUI.getState().dataset).toBe('./tests/datasets/triage.ts')
  useUI.getState().setReaderDomain('admin')
  expect(useUI.getState()).toMatchObject({ level: 'data', dataset: null })
  useUI.getState().openSchema()
})

test('the Data level reads a dataset through the lens; the Schema is one step back', () => {
  const ui = () => useUI.getState()
  ui().setReaderDomain('services')
  ui().setLens('behavior')
  ui().selectClass('class.Service', 'services')
  ui().openDataLevel('./tests/datasets/identity-owners.ts')
  expect(ui()).toMatchObject({
    level: 'data',
    dataset: './tests/datasets/identity-owners.ts',
    lens: 'behavior',
  })

  // the lens switches in place, Rules included, and the selection stays
  ui().setLens('rules')
  ui().setLens('structure')
  expect(ui()).toMatchObject({ level: 'data', lens: 'structure', selectedClass: 'class.Service' })

  // back to the Schema, the dataset kept: the crumb still names it
  ui().openSchema()
  expect(ui()).toMatchObject({
    level: 'domain',
    dataset: './tests/datasets/identity-owners.ts',
    selectedClass: 'class.Service',
  })
  ui().selectClass(undefined)
})

test('the Workspace level names no Domain, and every way into a level reads one again', () => {
  const ui = () => useUI.getState()
  ui().setReaderDomain('issues')
  ui().setLens('behavior')
  const entries: [string, () => void][] = [
    ['openSchema', () => ui().openSchema()],
    ['openDomain', () => ui().openDomain('issues')],
    ['revealAnchor', () => ui().revealAnchor('class.Issue', 'issues')],
    ['setLens', () => ui().setLens('structure')],
  ]
  for (const [name, enter] of entries) {
    ui().openWorkspace()
    expect(ui().level).toBe('workspace')
    // the Domain read before stays: opening it again lands where it was left
    expect(ui().readerDomainId).toBe('issues')
    enter()
    expect([name, ui().level]).toEqual([name, 'domain'])
  }

  // the level is not persisted: opening the Studio lands on a Domain
  ui().openWorkspace()
  expect(Object.keys(uiWorkspaceSnapshot())).not.toContain('level')
  ui().openSchema()
})

test('opening a Domain from the Workspace level keeps its selection, and drops another one', () => {
  const ui = () => useUI.getState()
  ui().setReaderDomain('issues')
  ui().selectClass('class.Issue', 'issues')
  ui().openDataLevel('./tests/datasets/triage.ts')
  ui().openWorkspace()
  ui().openDomain('issues')
  expect(ui()).toMatchObject({
    level: 'domain',
    readerDomainId: 'issues',
    selectedClass: 'class.Issue',
    selectionDomainId: 'issues',
    // the dataset is the Domain's too: the crumb still names it
    dataset: './tests/datasets/triage.ts',
  })

  ui().openWorkspace()
  ui().openDomain('admin')
  expect(ui()).toMatchObject({
    readerDomainId: 'admin',
    selectedClass: undefined,
    selectionDomainId: undefined,
    focusId: null,
    dataset: null,
  })
})

test("the Domain shown is one there is to read: the Workspace's, or a Publication", () => {
  const domains = [{ id: 'issues' }, { id: 'admin' }]
  const publication = publishedDomainId('issues.astrale.ai', '0.9.0')
  expect(shownDomainId({ readerDomainId: 'admin', selectionDomainId: 'issues' }, domains)).toBe(
    'admin',
  )
  expect(shownDomainId({ readerDomainId: publication }, domains)).toBe(publication)
  // a Domain the Workspace no longer holds falls to the selection's, then to the first
  expect(shownDomainId({ readerDomainId: 'gone', selectionDomainId: 'admin' }, domains)).toBe(
    'admin',
  )
  expect(shownDomainId({ readerDomainId: 'gone' }, domains)).toBe('issues')
  expect(shownDomainId({ readerDomainId: '@registry:issues.astrale.ai@latest' }, domains)).toBe(
    'issues',
  )
  expect(shownDomainId({}, [])).toBeUndefined()
})

test('a Publication read leaves the last workspace Domain as the one a bare `/` opens', () => {
  useUI.getState().openDomain('issues')
  expect(uiWorkspaceSnapshot().readerDomainId).toBe('issues')
  useUI.getState().openDomain(publishedDomainId('issues.astrale.ai', '0.9.0'))
  expect('readerDomainId' in uiWorkspaceSnapshot()).toBe(false)
  useUI.setState({ readerDomainId: undefined })
  // no Domain read at all forgets the last one
  expect(uiWorkspaceSnapshot().readerDomainId).toBeNull()
  useUI.getState().openDomain('issues')
})
