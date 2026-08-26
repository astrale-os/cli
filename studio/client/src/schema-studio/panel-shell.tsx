import { X } from 'lucide-react'

export function PanelShell({
  onClose,
  children,
}: {
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="relative min-h-0 w-[420px] shrink-0 border-l bg-card">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close panel"
        title="Close (Esc)"
        className="absolute right-3.5 top-3.5 z-20 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      {children}
    </div>
  )
}
