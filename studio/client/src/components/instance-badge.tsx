import type { DeployResult, InstanceStatus } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Check, CloudUpload, Loader2, TriangleAlert } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { relativeTime, shortHash } from '@/lib/format'
import { useBundle, useInstance } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

interface Health {
  /** the one word on the chip and in the Status row */
  word: string
  tone: string
  dot: string
  /** what that word means, in a sentence — omitted when nothing needs saying */
  detail?: string
}

/** Everything the popover says about the deploy, decided in one place. */
function health(status: InstanceStatus): Health {
  const grey = { tone: 'text-muted-foreground', dot: 'bg-muted-foreground/40' }
  const warn = { tone: 'text-warning', dot: 'bg-warning' }
  if (!status.deployTarget)
    return {
      word: 'no target',
      ...grey,
      detail: 'Set prod.instance in astrale.config.ts to choose where this domain runs.',
    }
  if (!status.deployable)
    return {
      word: 'not deployable',
      ...grey,
      detail: 'This domain has no prod script in package.json, so the studio cannot deploy it.',
    }
  if (status.install === 'unknown')
    return {
      word: 'unknown',
      ...grey,
      detail: 'The instance did not answer, so its version is unknown. Deploying still works.',
    }
  if (status.install === 'not-installed')
    return { word: 'not installed', ...warn, detail: 'This domain has never been deployed there.' }
  if (status.drift === 'drifted')
    return {
      word: 'out of date',
      ...warn,
      detail: 'The instance runs an older version of this schema.',
    }
  return { word: 'up to date', tone: 'text-success', dot: 'bg-success' }
}

function buttonLabel(status: InstanceStatus): string {
  if (status.install !== 'installed') return 'Deploy'
  return status.drift === 'drifted' ? 'Deploy update' : 'Deploy again'
}

/** One fact: what it is on the left, what it says on the right. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px]">{children}</span>
    </div>
  )
}

/**
 * The deploy chip in the header: where this domain runs, whether that copy is
 * the current schema, and the one button that updates it.
 */
export function InstanceBadge({ domainId }: { domainId: string }) {
  const { data: status } = useInstance(domainId)
  const { data: bundle } = useBundle(domainId)
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<'idle' | 'deploying' | 'done'>('idle')
  const [result, setResult] = useState<DeployResult | null>(null)

  if (!status) return null
  const state = health(status)
  const depsMissing = bundle ? !bundle.depsInstalled : false
  const canDeploy = status.deployable && !!status.deployTarget

  const deploy = async () => {
    setPhase('deploying')
    setResult(null)
    try {
      const deployed = await api.deployInstance(domainId)
      setResult(deployed)
      setPhase('done')
      queryClient.invalidateQueries({ queryKey: qk.instance(domainId) })
      if (deployed.ok) toast.success(`Deployed to ${status.deployTarget}`)
      else toast.error('Deploy failed')
    } catch (error) {
      setResult({ ok: false, url: null, output: String(error) })
      setPhase('done')
    }
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open && phase !== 'deploying') {
          setPhase('idle')
          setResult(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Deploy — ${state.word}`}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-card px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <CloudUpload className="h-3.5 w-3.5" />
          <span>Deploy</span>
          <span
            className={cn('h-1.5 w-1.5 rounded-full', depsMissing ? 'bg-warning' : state.dot)}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <div className="space-y-1.5">
          <Row label="Runs on">
            <span className="font-medium">{status.deployTarget ?? 'nowhere yet'}</span>
          </Row>
          {status.deployTarget && (
            <Row label="Schema there">
              <span className={cn('inline-flex items-center gap-1.5 font-medium', state.tone)}>
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', state.dot)} />
                {state.word}
              </span>
            </Row>
          )}
          {status.drift === 'drifted' ? (
            <>
              <Row label="Version here">
                <code className="font-mono text-[11px]">
                  {shortHash(status.localRevision ?? '')}
                </code>
              </Row>
              <Row label="Version there">
                <code className="font-mono text-[11px] text-muted-foreground">
                  {shortHash(status.installedRevision ?? '')}
                </code>
              </Row>
            </>
          ) : (
            <Row label="Version here">
              <code className="font-mono text-[11px] text-muted-foreground">
                {shortHash(status.localRevision ?? '')}
              </code>
            </Row>
          )}
          {status.lastDeploy && (
            <Row label="Last deploy">
              <span className="text-muted-foreground">{relativeTime(status.lastDeploy.at)}</span>
              {status.lastDeploy.url && (
                <a
                  href={status.lastDeploy.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1.5 inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  open
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
            </Row>
          )}
        </div>

        {(state.detail || depsMissing) && (
          <div className="space-y-1 text-[11px] leading-snug">
            {state.detail && <p className="text-muted-foreground">{state.detail}</p>}
            {depsMissing && <p className="text-warning">Dependencies are not installed here.</p>}
          </div>
        )}

        {canDeploy &&
          (phase === 'idle' ? (
            <Button size="sm" className="w-full" onClick={deploy}>
              <CloudUpload className="h-3.5 w-3.5" /> {buttonLabel(status)}
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
                {result?.ok ? 'Deployed' : 'Deploy failed'}
              </div>
              {result?.output && (
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-1.5 text-[10px] leading-tight text-muted-foreground">
                  {result.output.slice(-1200)}
                </pre>
              )}
              <Button
                size="xs"
                variant="outline"
                className="w-full"
                onClick={() => setPhase('idle')}
              >
                Done
              </Button>
            </div>
          ))}
      </PopoverContent>
    </Popover>
  )
}
