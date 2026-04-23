import { ArrowRightLeft, Check, Copy } from 'lucide-react'
import { useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import type { OpCallResult } from './op-form'

interface OpResultProps {
  result: OpCallResult
}

export function OpResult({ result }: OpResultProps) {
  const isError = !!result.error
  const [copied, setCopied] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  const text = isError ? (result.error ?? '') : JSON.stringify(result.data, null, 2)

  function handleCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    clearTimeout(timeout.current)
    timeout.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="relative">
      <h3 className="text-sm font-medium mb-2">{isError ? 'Error' : 'Result'}</h3>
      {result.routedFallback && (
        <div className="flex items-center gap-1.5 mb-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-1.5 text-xs text-yellow-700 dark:text-yellow-400">
          <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" />
          <span>
            No route binding — fell back to <strong>envelope</strong>
          </span>
        </div>
      )}
      <button
        onClick={handleCopy}
        title="Copy result"
        className="absolute right-2 top-9 rounded bg-background/80 p-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
      <pre
        className={cn(
          'rounded-md border p-4 pr-8 text-xs font-mono overflow-auto max-h-96',
          isError
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : 'border-border bg-muted/50',
        )}
      >
        {text}
      </pre>
    </div>
  )
}
