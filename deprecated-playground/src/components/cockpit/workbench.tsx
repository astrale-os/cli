import type { WorkbenchTab } from '@/providers/workspace'

import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'

import { ConsolePanel } from './panels/console-panel'
import { OperationsPanel } from './panels/operations-panel'

const tabs: { key: WorkbenchTab; label: string }[] = [
  { key: 'operations', label: 'Operations' },
  { key: 'console', label: 'Console' },
]

export function Workbench() {
  const { activeTab, setActiveTab } = useWorkspace()

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center border-b border-border h-9 px-3 gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-3 py-1 text-xs rounded-sm transition-colors',
              activeTab === tab.key
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        <div className={activeTab === 'operations' ? 'h-full' : 'hidden'}>
          <OperationsPanel />
        </div>
        <div className={activeTab === 'console' ? 'h-full' : 'hidden'}>
          <ConsolePanel />
        </div>
      </div>
    </div>
  )
}
