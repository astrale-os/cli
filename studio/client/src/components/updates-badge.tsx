import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpCircle, Check, Loader2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { useUpdates } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

/**
 * The header "Update" chip — rendered ONLY when the CLI, Astrale skills, or an @astrale-os/* SDK
 * dep is behind (invisible when everything is current). The check is the CLI's own
 * `astrale update --check --json` (via /api/domain/:id/updates); the popover lists
 * what's behind and an "Update now" button that runs `astrale update --yes` in the
 * domain root. On success we re-check, so the badge clears itself.
 */
export function UpdatesBadge({ domainId }: { domainId: string }) {
  const { data } = useUpdates(domainId)
  const qc = useQueryClient()
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [result, setResult] = useState<{ ok: boolean; output: string } | null>(null)

  // Stay mounted while an update is in flight / showing its result, even if the
  // re-check has already cleared `stale` — otherwise the popover vanishes before
  // the user sees the outcome.
  if (!data?.stale && phase === 'idle') return null

  const { cli, skills, sdk } = data ?? {
    cli: { stale: false },
    skills: { status: 'current' as const },
    sdk: { stale: false, outdated: [] },
  }

  const run = async () => {
    setPhase('running')
    setResult(null)
    try {
      const r = await api.applyUpdate(domainId)
      setResult(r)
      setPhase('done')
      if (r.ok) {
        toast.success('Updated')
        qc.invalidateQueries({ queryKey: qk.updates(domainId) })
      } else {
        toast.error('Update failed')
      }
    } catch (e) {
      setResult({ ok: false, output: String(e) })
      setPhase('done')
    }
  }

  return (
    <Popover
      onOpenChange={(o) => {
        if (!o) {
          setPhase('idle')
          setResult(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Update available"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
        >
          <ArrowUpCircle className="h-3.5 w-3.5" />
          <span>Update</span>
          <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2.5 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Update available
        </div>

        {cli.stale && (
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-medium text-foreground">Astrale CLI</span>
            <span className="shrink-0 font-mono text-muted-foreground">
              {cli.current} → {cli.latest}
              {cli.channel ? (
                <span className="text-muted-foreground/60"> ({cli.channel})</span>
              ) : null}
            </span>
          </div>
        )}

        {(skills.status === 'update-available' || skills.status === 'repair-needed') && (
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-medium text-foreground">Astrale skills</span>
            <span className="text-muted-foreground">
              {skills.status === 'repair-needed' ? 'Repair needed' : 'Update available'}
            </span>
          </div>
        )}

        {sdk.stale && (
          <div className="space-y-0.5 text-[11px]">
            <div className="font-medium text-foreground">SDK packages</div>
            {sdk.outdated.map((o) => (
              <div
                key={o.pkg}
                className="flex items-center justify-between gap-2 font-mono text-muted-foreground"
              >
                <span className="truncate">{o.pkg}</span>
                <span className="shrink-0">
                  {o.current} → {o.latest}
                </span>
              </div>
            ))}
          </div>
        )}

        {phase === 'idle' ? (
          <Button size="sm" className="w-full" onClick={run}>
            <ArrowUpCircle className="h-3.5 w-3.5" /> Update now
          </Button>
        ) : phase === 'running' ? (
          <Button size="sm" className="w-full" disabled>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating…
          </Button>
        ) : (
          <div className="space-y-1.5">
            <div
              className={cn(
                'flex items-center gap-1.5 text-xs font-medium',
                result?.ok ? 'text-success' : 'text-destructive',
              )}
            >
              {result?.ok ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <TriangleAlert className="h-3.5 w-3.5" />
              )}
              {result?.ok ? 'Updated' : 'Failed'}
            </div>
            {result?.output && (
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-1.5 text-[10px] leading-tight text-muted-foreground">
                {result.output.slice(-1600)}
              </pre>
            )}
            <Button size="xs" variant="outline" className="w-full" onClick={() => setPhase('idle')}>
              Done
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
