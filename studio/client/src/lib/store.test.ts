import { expect, test } from 'bun:test'

import { useUI } from './store'

test('clearing the selection closes the detail it opened, and leaves an overlay panel alone', () => {
  useUI.getState().selectClass('class.Monitor')
  expect(useUI.getState().selectedClass).toBe('class.Monitor')
  expect(useUI.getState().focusId).toBe('class.Monitor')

  useUI.getState().clearSelection()
  expect(useUI.getState().selectedClass).toBeUndefined()
  expect(useUI.getState().focusId).toBeNull()

  // Views / Domains / Integrations are opened from the toolbar, not by selecting
  // anything — clicking empty space unselects; it does not close them.
  useUI.getState().setPanelOverlay('views')
  useUI.getState().clearSelection()
  expect(useUI.getState().panelOverlay).toBe('views')
})

test('revealing a relationship asks the canvas for the LINE, and pins no focus on it', () => {
  // A comment anchored to `edge.SubscribedTo` opens the relationship exactly like a class —
  // same `class.` selection namespace — but focus fades everything a NODE is not wired to,
  // and a relationship is not one: pinned on its name it would fade the whole canvas.
  useUI.getState().revealAnchor('edge.SubscribedTo')
  expect(useUI.getState().selectedClass).toBe('class.SubscribedTo')
  expect(useUI.getState().focusId).toBeNull()
  expect(useUI.getState().revealTarget).toBe('edge.SubscribedTo')
  expect(useUI.getState().revealedRef).toBe('edge.SubscribedTo')

  // a field of that relationship opens the relationship, and still points at the line
  useUI.getState().revealAnchor('edge.SubscribedTo.endpoint.customer')
  expect(useUI.getState().selectedClass).toBe('class.SubscribedTo')
  expect(useUI.getState().focusId).toBeNull()
  expect(useUI.getState().revealTarget).toBe('edge.SubscribedTo')

  // a node class is unchanged: it has a card, so focus pins to it and the canvas frames it
  useUI.getState().revealAnchor('class.Company')
  expect(useUI.getState().focusId).toBe('class.Company')
  expect(useUI.getState().revealTarget).toBe('class.Company')
})
