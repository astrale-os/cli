import { expect, test } from 'bun:test'

import { agentDraftOf, useUI } from './store'

test('clearing the selection closes the detail it opened, and leaves an overlay panel alone', () => {
  useUI.getState().selectClass('class.Monitor', 'ops')
  expect(useUI.getState().selectedClass).toBe('class.Monitor')
  expect(useUI.getState().focusId).toBe('class.Monitor')

  useUI.getState().clearSelection()
  expect(useUI.getState().selectedClass).toBeUndefined()
  expect(useUI.getState().focusId).toBeNull()

  // Views / Domains / Integrations are opened from the toolbar, not by selecting
  // anything — clicking empty space unselects; it does not close them.
  useUI.getState().setPanelOverlay('views')
  useUI.getState().clearSelection()
  expect(useUI.getState().panelOverlay).toEqual({ kind: 'views' })
})

test('revealing a relationship asks the canvas for the LINE, and pins no focus on it', () => {
  // A comment anchored to `edge.SubscribedTo` opens the relationship exactly like a class —
  // same `class.` selection namespace — but focus fades everything a NODE is not wired to,
  // and a relationship is not one: pinned on its name it would fade the whole canvas.
  useUI.getState().revealAnchor('edge.SubscribedTo', 'crm')
  expect(useUI.getState().selectedClass).toBe('class.SubscribedTo')
  expect(useUI.getState().focusId).toBeNull()
  expect(useUI.getState().revealTarget).toBe('edge.SubscribedTo')
  expect(useUI.getState().revealedRef).toBe('edge.SubscribedTo')

  // a field of that relationship opens the relationship, and still points at the line
  useUI.getState().revealAnchor('edge.SubscribedTo.endpoint.customer', 'crm')
  expect(useUI.getState().selectedClass).toBe('class.SubscribedTo')
  expect(useUI.getState().focusId).toBeNull()
  expect(useUI.getState().revealTarget).toBe('edge.SubscribedTo')

  // a node class is unchanged: it has a card, so focus pins to it and the canvas frames it
  useUI.getState().revealAnchor('class.Company', 'crm')
  expect(useUI.getState().focusId).toBe('class.Company')
  expect(useUI.getState().revealTarget).toBe('class.Company')
})

test('a draft belongs to the chat it was written for, and waits there', () => {
  useUI.setState({ agentDrafts: {} })
  const drafts = () => useUI.getState().agentDrafts

  useUI.getState().setAgentDraft('chat-a', 'rename the Order class')
  useUI.getState().setAgentDraft('chat-b', 'write the billing tests')

  // switching tabs is not switching recipients: each chat shows its own message
  expect(agentDraftOf(drafts(), 'chat-a')).toBe('rename the Order class')
  expect(agentDraftOf(drafts(), 'chat-b')).toBe('write the billing tests')
  // and a chat nobody has written to yet is empty, not a neighbour's message
  expect(agentDraftOf(drafts(), 'chat-c')).toBe('')

  // closing a chat takes its draft with it — there is nothing left to send it to
  useUI.getState().dropAgentDraft('chat-a')
  expect(agentDraftOf(drafts(), 'chat-a')).toBe('')
  expect(agentDraftOf(drafts(), 'chat-b')).toBe('write the billing tests')
})

test('what was typed before the chat list landed goes to the first chat, once', () => {
  useUI.setState({ agentDrafts: {} })
  const drafts = () => useUI.getState().agentDrafts

  // the composer is on screen before `GET /agent/chats` answers
  useUI.getState().setAgentDraft(undefined, 'add a Payment class')
  expect(agentDraftOf(drafts(), undefined)).toBe('add a Payment class')

  useUI.getState().adoptAgentDraft('chat-a')
  expect(agentDraftOf(drafts(), 'chat-a')).toBe('add a Payment class')
  // handed over, not copied: the next chat must not inherit it too
  expect(agentDraftOf(drafts(), undefined)).toBe('')
  useUI.getState().adoptAgentDraft('chat-b')
  expect(agentDraftOf(drafts(), 'chat-b')).toBe('')
})

test('adopting never writes over a chat that is already being written to', () => {
  useUI.setState({ agentDrafts: {} })
  useUI.getState().setAgentDraft(undefined, 'stray')
  useUI.getState().setAgentDraft('chat-a', 'the real message')

  useUI.getState().adoptAgentDraft('chat-a')
  expect(agentDraftOf(useUI.getState().agentDrafts, 'chat-a')).toBe('the real message')
})
