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
