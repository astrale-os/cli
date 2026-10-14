import type { InstanceDomain } from '@shared/contracts/workspace'

import { ArrowUp, ExternalLink, Server } from 'lucide-react'

import { useInstanceDomains, useInstances } from '@/lib/hooks'

import { instancePageUrl } from './instance-switcher'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Skeleton } from './ui/skeleton'

/**
 * What the rail prints for an installation: its registry version, else the head of its deployment
 * name (`1.4.2 + 7 commits` of `1.4.2 + 7 commits · a1b2c3d · staging`).
 */
export function installedLabel(domain: InstanceDomain): string {
  return domain.version ?? domain.name.split(' · ')[0]!
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

function OpenLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={`Open ${label} (${hostOf(url)})`}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}

/**
 * Beside a workspace Domain in the rail: the version installed on the active instance, with a dot
 * when a newer one is available. A click opens what runs there: version, update, deployment. The
 * listing is read once per instance (one CLI call reaching its Kernel) and shared by every row;
 * nothing shows for a Domain the instance does not run, or when the listing cannot be read.
 */
export function DomainInstalledChip({ origin }: { origin: string }) {
  const { data: instances } = useInstances()
  const active = instances?.instances.find((instance) => instance.active && instance.owned)
  const { data, isPending } = useInstanceDomains(active?.name)
  if (!active) return null
  if (isPending) return <Skeleton className="h-3 w-8 shrink-0 rounded" />
  const domain = data?.domains.find((item) => item.origin === origin)
  if (!domain) return null

  const label = installedLabel(domain)
  const instanceUrl = instancePageUrl(active.url)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${label} installed on ${active.name}${domain.available ? ` (${domain.available} available)` : ''}`}
          className="inline-flex h-5 shrink-0 items-center gap-1 rounded px-1 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <span className="max-w-16 truncate">{label}</span>
          {domain.available && <span className="h-1.5 w-1.5 rounded-full bg-warning" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-72 overflow-hidden p-0">
        <div className="flex items-center gap-2.5 border-b bg-muted/40 px-3 py-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
            <Server className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Installed on
            </span>
            <span className="block truncate text-sm font-semibold">{active.name}</span>
          </span>
          {instanceUrl && <OpenLink url={instanceUrl} label={active.name} />}
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 p-3 text-[12px]">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="flex min-w-0 items-center gap-1.5">
            {domain.version ? (
              <span className="truncate rounded border bg-muted/40 px-1.5 py-px font-mono text-[11px]">
                {domain.version}
              </span>
            ) : (
              <span className="text-muted-foreground">unpublished</span>
            )}
            {domain.available && (
              <span
                title={`${domain.available} is available`}
                className="inline-flex shrink-0 items-center gap-0.5 rounded border border-warning/40 bg-warning/10 px-1 py-px font-mono text-[11px] text-warning"
              >
                <ArrowUp className="h-2.5 w-2.5" />
                {domain.available}
              </span>
            )}
          </dd>
          {domain.name !== domain.version && (
            <>
              <dt className="text-muted-foreground">Build</dt>
              <dd className="truncate font-mono text-[11px]" title={domain.name}>
                {domain.name}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Deployment</dt>
          <dd className="flex min-w-0 items-center gap-1">
            {domain.url ? (
              <>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={domain.url}>
                  {hostOf(domain.url)}
                </span>
                <OpenLink url={domain.url} label={origin} />
              </>
            ) : (
              <span className="text-muted-foreground">local install</span>
            )}
          </dd>
        </dl>
      </PopoverContent>
    </Popover>
  )
}
