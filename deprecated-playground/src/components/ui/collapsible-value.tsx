import { useState, useRef, useEffect } from 'react'

interface CollapsibleValueProps {
  children: React.ReactNode
}

export function CollapsibleValue({ children }: CollapsibleValueProps) {
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) setClamped(el.scrollHeight > el.clientHeight + 4)
  }, [children])

  return (
    <div>
      <div
        ref={ref}
        className={
          expanded
            ? 'font-mono text-foreground/80 mt-0.5 break-all whitespace-pre-wrap'
            : 'font-mono text-foreground/80 mt-0.5 break-all whitespace-pre-wrap line-clamp-2'
        }
      >
        {children}
      </div>
      {clamped && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-muted-foreground hover:text-foreground mt-0.5"
        >
          {expanded ? 'Hide' : 'Show more'}
        </button>
      )}
    </div>
  )
}
