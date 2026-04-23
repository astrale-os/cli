import type { ImperativePanelHandle } from 'react-resizable-panels'

import { useState, useRef, useEffect } from 'react'

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { useHotkeys } from '@/hooks/use-hotkeys'
import { useWorkspace } from '@/hooks/use-workspace'

import { CommandBar } from './command-bar'
import { CommandPalette } from './command-palette'
import { GraphCanvas } from './graph-canvas'
import { Inspector } from './inspector'
import { Workbench } from './workbench'

function PickerOverlay() {
  return (
    <div className="absolute inset-0 z-30 bg-background/80 backdrop-blur-[2px] pointer-events-none" />
  )
}

export function CockpitLayout({ label, onBack }: { label?: string; onBack?: () => void }) {
  const workspace = useWorkspace()
  const [paletteOpen, setPaletteOpen] = useState(false)
  useHotkeys(workspace, { onCommandPalette: () => setPaletteOpen(true) })

  const inspectorRef = useRef<ImperativePanelHandle>(null)
  const workbenchRef = useRef<ImperativePanelHandle>(null)

  // Ref flag to prevent infinite sync loops between workspace state and panel state.
  // When we programmatically expand/collapse a panel, the onExpand/onCollapse callbacks
  // fire — we need to ignore those callbacks to avoid dispatching redundant actions
  // that would trigger the effect again.
  const isSyncing = useRef(false)

  // Sync workspace.panels.inspector -> panel imperative API
  useEffect(() => {
    const panel = inspectorRef.current
    if (!panel) return

    isSyncing.current = true
    if (workspace.panels.inspector) {
      panel.expand()
    } else {
      panel.collapse()
    }
    queueMicrotask(() => {
      isSyncing.current = false
    })
  }, [workspace.panels.inspector])

  // Sync workspace.panels.workbench -> panel imperative API
  useEffect(() => {
    const panel = workbenchRef.current
    if (!panel) return

    isSyncing.current = true
    if (workspace.panels.workbench) {
      panel.expand()
    } else {
      panel.collapse()
    }
    queueMicrotask(() => {
      isSyncing.current = false
    })
  }, [workspace.panels.workbench])

  // Auto-open/close inspector based on selection
  useEffect(() => {
    workspace.setPanel('inspector', !!workspace.selection)
  }, [workspace.selection]) // eslint-disable-line react-hooks/exhaustive-deps

  const isPicking = !!workspace.nodePicker

  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <CommandBar onOpenPalette={() => setPaletteOpen(true)} label={label} onBack={onBack} />
        <ResizablePanelGroup direction="horizontal" autoSaveId="cockpit-h">
          {/* Left panel: Workbench (Operations, Query, Console) */}
          <ResizablePanel
            ref={workbenchRef}
            defaultSize={22}
            minSize={14}
            maxSize={40}
            collapsible
            collapsedSize={0}
            onCollapse={() => {
              if (!isSyncing.current) {
                workspace.setPanel('workbench', false)
              }
            }}
            onExpand={() => {
              if (!isSyncing.current) {
                workspace.setPanel('workbench', true)
              }
            }}
          >
            <div className="relative h-full">
              <Workbench />
              {isPicking && <PickerOverlay />}
            </div>
          </ResizablePanel>
          <ResizableHandle />

          {/* Center panel: Graph canvas */}
          <ResizablePanel defaultSize={53} minSize={30}>
            <GraphCanvas />
          </ResizablePanel>
          <ResizableHandle />

          {/* Right panel: Inspector */}
          <ResizablePanel
            ref={inspectorRef}
            defaultSize={25}
            minSize={12}
            maxSize={45}
            collapsible
            collapsedSize={0}
            onCollapse={() => {
              if (!isSyncing.current) {
                workspace.setPanel('inspector', false)
              }
            }}
            onExpand={() => {
              if (!isSyncing.current) {
                workspace.setPanel('inspector', true)
              }
            }}
          >
            <div className="relative h-full">
              <Inspector />
              {isPicking && <PickerOverlay />}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}
