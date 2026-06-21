import type { DeployResult, InstanceStatus } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { Check, CloudUpload, Loader2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { shortHash } from '@/lib/format'
import { useBundle, useInstance, useInstances } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

function statusOf(s: InstanceStatus): { word: string; tone: string; dot: string } {
  if (!s.deployable)
    return { word: 'local only', tone: 'text-muted-foreground', dot: 'bg-muted-foreground/40' }
  if (s.install === 'unknown')
    return { word: 'unreachable', tone: 'text-muted-foreground', dot: 'bg-muted-foreground/40' }
  if (s.install === 'not-installed')
    return { word: 'not installed', tone: 'text-warning', dot: 'bg-warning' }
  if (s.drift === 'drifted') return { word: 'drifted', tone: 'text-warning', dot: 'bg-warning' }
  return { word: 'installed', tone: 'text-success', dot: 'bg-success' }
}

/**
 * The single domain/instance status chip in the header — merges "is the schema
 * healthy here" with "is it installed on the instance". Deliberately minimal:
 * the deploy target, one status word, the schema hash, and a gated deploy.
 */
export function InstanceBadge({ domainId }: { domainId: string }) {
  const { data } = useInstance(domainId)
  const { data: bundle } = useBundle(domainId)
  const { data: instances } = useInstances()
  const qc = useQueryClient()
  const [phase, setPhase] = useState<'idle' | 'deploying' | 'done'>('idle')
  const [result, setResult] = useState<DeployResult | null>(null)

  if (!data) return null
  const st = statusOf(data)
  const depsMissing = bundle ? !bundle.depsInstalled : false
  // deploy goes to the domain's config target, which may NOT be the active instance
  const active = instances?.active ?? null
  const targetDiffersFromActive = !!data.deployTarget && !!active && data.deployTarget !== active

  const deploy = async () => {
    setPhase('deploying')
    setResult(null)
    try {
      const r = await api.deployInstance(domainId)
      setResult(r)
      setPhase('done')
      qc.invalidateQueries({ queryKey: qk.instance(domainId) })
      if (r.ok) toast.success('Deployed & installed')
      else toast.error('Deploy failed')
    } catch (e) {
      setResult({ ok: false, url: null, output: String(e) })
      setPhase('done')
    }
  }

  return (
    <Popover
      onOpenChange={(o) => {
        if (!o && phase !== 'deploying') {
          setPhase('idle')
          setResult(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Deploy — ${st.word}`}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-card px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <CloudUpload className="h-3.5 w-3.5" />
          <span>Deploy</span>
          <span className={cn('h-1.5 w-1.5 rounded-full', depsMissing ? 'bg-warning' : st.dot)} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2.5 p-3">
        {/* the deploy TARGET (from config) — distinct from the active instance top-left */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Deploy target instance
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold">
              {data.deployTarget ?? 'no target'}
            </span>
            <span
              className={cn('inline-flex shrink-0 items-center gap-1 text-xs font-medium', st.tone)}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} /> {st.word}
            </span>
          </div>
          {data.deployTarget && (
            <div className="mt-0.5 text-[10px] text-muted-foreground/60">
              from <code className="font-mono">astrale.config.ts</code>
            </div>
          )}
        </div>
        {/* schema identity — when drifted, show local vs the schema actually on the instance */}
        {data.drift === 'drifted' ? (
          <div className="space-y-0.5 font-mono text-[11px]">
            <div className="text-warning">local {shortHash(data.localHash ?? '')}</div>
            <div className="text-muted-foreground">
              on instance {shortHash(data.installedHash ?? '')}
            </div>
          </div>
        ) : (
          <div className="font-mono text-[11px] text-muted-foreground">
            {shortHash(data.localHash ?? '')}
          </div>
        )}

        {data.install === 'unknown' && data.deployTarget && (
          <div className="text-[11px] text-muted-foreground">
            Can’t reach it to check status — deploy still works.
          </div>
        )}
        {depsMissing && <div className="text-[11px] text-warning">Dependencies not installed</div>}
        {targetDiffersFromActive && (
          <div className="text-[11px] leading-snug text-muted-foreground">
            Independent of your active instance (<b>{active}</b>).
          </div>
        )}

        {!data.deployable ? null : phase === 'idle' ? (
          <Button size="sm" className="w-full" onClick={deploy}>
            <CloudUpload className="h-3.5 w-3.5" />{' '}
            {data.install === 'installed' ? 'Re-deploy' : 'Deploy & install'}
          </Button>
        ) : phase === 'deploying' ? (
          <Button size="sm" className="w-full" disabled>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Deploying…
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
              {result?.ok ? 'Deployed' : 'Failed'}
            </div>
            {result?.output && (
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-1.5 text-[10px] leading-tight text-muted-foreground">
                {result.output.slice(-1200)}
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
