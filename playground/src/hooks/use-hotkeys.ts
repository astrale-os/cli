import { useEffect } from 'react'

import type { WorkspaceContextValue } from '@/providers/workspace'

const CANVAS_MODES = ['graph', 'schema', 'filesystem'] as const

export interface HotkeyCallbacks {
  onCommandPalette?: () => void
}

export function useHotkeys(workspace: WorkspaceContextValue, callbacks?: HotkeyCallbacks) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key === 'k') {
        e.preventDefault()
        callbacks?.onCommandPalette?.()
      } else if (mod && e.key === '1') {
        e.preventDefault()
        workspace.setActiveTab('operations')
        workspace.setPanel('workbench', true)
      } else if (mod && e.key === '2') {
        e.preventDefault()
        workspace.setActiveTab('query')
        workspace.setPanel('workbench', true)
      } else if (mod && e.key === '3') {
        e.preventDefault()
        workspace.setActiveTab('console')
        workspace.setPanel('workbench', true)
      } else if (mod && e.key === '5') {
        e.preventDefault()
        const idx = CANVAS_MODES.indexOf(workspace.canvasMode)
        workspace.setCanvasMode(CANVAS_MODES[(idx + 1) % CANVAS_MODES.length])
      } else if (mod && e.key === 'b') {
        e.preventDefault()
        workspace.togglePanel('workbench')
      } else if (mod && e.key === 'i') {
        e.preventDefault()
        workspace.togglePanel('inspector')
      } else if (e.key === 'Escape') {
        if (workspace.nodePicker) workspace.cancelNodePicker()
        else if (workspace.selection) workspace.setSelection(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [workspace, callbacks])
}
