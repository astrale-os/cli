interface PropertiesTableProps {
  properties: Record<string, { type?: string }>
}

export function PropertiesTable({ properties }: PropertiesTableProps) {
  const entries = Object.entries(properties)
  if (entries.length === 0) return null

  return (
    <div>
      <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">Properties</h4>
      <div className="rounded border border-border divide-y divide-border">
        <div className="grid grid-cols-2 px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50">
          <span>Name</span>
          <span>Type</span>
        </div>
        {entries.map(([name, def]) => (
          <div key={name} className="grid grid-cols-2 px-3 py-1.5 text-sm">
            <span className="font-mono text-xs">{name}</span>
            <span className="text-xs text-muted-foreground">{def?.type ?? 'unknown'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
