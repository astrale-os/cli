import { expect, test } from 'bun:test'

import { agentDraftOf, useUI } from './store'

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
