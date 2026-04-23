import { ArrowLeft } from 'lucide-react'

import type { BindingMode } from '@/providers/connection'

import { useConnection } from '@/hooks/use-connection'
import { cn } from '@/lib/utils'

const BINDING_OPTIONS: { value: BindingMode; label: string }[] = [
  { value: 'envelope', label: 'Envelope' },
  { value: 'routed', label: 'Routed' },
]

export function CommandBar({
  onOpenPalette,
  label,
  onBack,
}: {
  onOpenPalette: () => void
  label?: string
  onBack?: () => void
}) {
  const connection = useConnection()

  return (
    <div className="flex h-9 items-center border-b border-border bg-muted/30 px-3 gap-3 text-xs">
      {/* Left section: breadcrumb + binding toggle + connection status */}
      <div className="flex items-center gap-2 shrink-0">
        {onBack && (
          <>
            <button
              onClick={onBack}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              All instances
            </button>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">{label}</span>
            <span className="text-muted-foreground">·</span>
          </>
        )}

        {/* Binding mode selector */}
        <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
          {BINDING_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => connection.setBindingMode(opt.value)}
              className={cn(
                'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                connection.bindingMode === opt.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {connection.status === 'connecting' && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-yellow-600 dark:text-yellow-400">Connecting...</span>
          </>
        )}

        {connection.status === 'error' && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-red-600 dark:text-red-400 truncate max-w-[300px]">
              {connection.error ?? 'Connection failed'}
            </span>
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right section: palette shortcut */}
      <span
        className="shrink-0 text-muted-foreground/60 cursor-pointer hover:text-foreground transition-colors"
        onClick={onOpenPalette}
      >
        &#8984;K
      </span>
    </div>
  )
}
