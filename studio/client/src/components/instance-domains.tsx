import type { InstanceDomain, InstanceSchedule } from '@shared/contracts/workspace'

import { ArrowUp, CalendarClock, ExternalLink, Pause, Play, Server, Zap } from 'lucide-react'
import { useState } from 'react'

import {
  useInstanceDomains,
  useInstances,
  useInstanceSchedules,
  useScheduleActions,
} from '@/lib/hooks'
import { relativeTime, untilTime } from '@/lib/time'
import { cn } from '@/lib/utils'

import { instancePageUrl } from './instance-switcher'
import { Button } from './ui/button'
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
  const [open, setOpen] = useState(false)
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
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent align="start" side="right" className="w-80 overflow-y-auto p-0">
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
        <DomainSchedules instance={active.name} origin={origin} open={open} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * What the Domain runs on its own on this instance: each Schedule (a declared `onSchedule`
 * trigger or a runtime Schedule) with its next and last tick and its state, from
 * `Schedule.status`. Pause and resume act on one Schedule; run now is an ordinary call of the
 * callable with the Schedule's input. Read only while the popover is open.
 */
function DomainSchedules({
  instance,
  origin,
  open,
}: {
  instance: string
  origin: string
  open: boolean
}) {
  const { data, isPending, error } = useInstanceSchedules(instance, origin, open)
  const actions = useScheduleActions(instance, origin)
  const reason =
    error instanceof Error ? error.message : data?.ok === false ? data.error : undefined
  return (
    <section aria-label="Schedules" className="border-t px-3 pb-3 pt-2.5">
      <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <CalendarClock className="h-3 w-3" />
        Schedules
      </h3>
      {isPending ? (
        <Skeleton className="h-14 w-full rounded-md" />
      ) : reason !== undefined || !data ? (
        <p className="text-[11px] text-muted-foreground" title={reason}>
          Schedules are not readable here.
        </p>
      ) : data.schedules.length === 0 ? (
        <p
          className="text-[11px] text-muted-foreground"
          title="Root and holders of schedule.reader read Schedules."
        >
          No schedules.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.schedules.map((schedule) => (
            <ScheduleRow key={schedule.id} schedule={schedule} actions={actions} />
          ))}
        </ul>
      )}
    </section>
  )
}

const STATE_TONE: Record<'active' | 'paused' | 'blocked', string> = {
  active: 'border-success/40 bg-success/10 text-success',
  paused: 'border-border bg-muted text-muted-foreground',
  blocked: 'border-warning/40 bg-warning/10 text-warning',
}

function ScheduleRow({
  schedule,
  actions,
}: {
  schedule: InstanceSchedule
  actions: ReturnType<typeof useScheduleActions>
}) {
  const { status } = schedule
  const label =
    schedule.name === 'default' ? schedule.callable : `${schedule.callable}/${schedule.name}`
  const acting = actions.act.isPending && actions.act.variables?.schedule === schedule.id
  const running = actions.run.isPending && actions.run.variables?.call === schedule.call
  const counts = status
    ? [
        status.missed > 0 && `${status.missed} missed`,
        status.skipped > 0 && `${status.skipped} skipped`,
        status.refused > 0 && `${status.refused} refused`,
      ].filter(Boolean)
    : []
  return (
    <li data-schedule={schedule.id} className="rounded-md border bg-muted/30 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium" title={label}>
          {label}
        </span>
        {status && (
          <span
            title={status.blocked}
            className={cn(
              'shrink-0 rounded border px-1 py-px text-[10px] font-medium',
              STATE_TONE[status.state],
            )}
          >
            {status.state}
          </span>
        )}
      </div>
      {status ? (
        <>
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
            {status.cron} · {status.timezone}
            {!status.declared && ' · runtime'}
          </div>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
            <dt className="text-muted-foreground">Next</dt>
            <dd title={status.next}>
              {status.state === 'paused'
                ? `paused${status.pausedAt ? ` ${relativeTime(status.pausedAt)}` : ''}`
                : status.next
                  ? untilTime(status.next)
                  : 'not scheduled yet'}
            </dd>
            <dt className="text-muted-foreground">Last</dt>
            <dd title={status.lastExecution ? `Execution ${status.lastExecution}` : status.cursor}>
              {status.cursor ? relativeTime(status.cursor) : 'never'}
              {counts.length > 0 && <span className="text-warning"> · {counts.join(' · ')}</span>}
            </dd>
          </dl>
        </>
      ) : (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={schedule.error}>
          Status not readable.
        </p>
      )}
      <div className="mt-1.5 flex gap-1">
        {status && (
          <Button
            size="xs"
            variant="outline"
            className="h-6 [&_svg]:size-3"
            disabled={acting}
            onClick={() =>
              actions.act.mutate({
                schedule: schedule.id,
                action: status.state === 'paused' ? 'resume' : 'pause',
              })
            }
          >
            {status.state === 'paused' ? <Play /> : <Pause />}
            {status.state === 'paused' ? 'Resume' : 'Pause'}
          </Button>
        )}
        {schedule.call && (
          <Button
            size="xs"
            variant="ghost"
            className="h-6 [&_svg]:size-3"
            disabled={running}
            title={`Call ${schedule.callable} now with this Schedule's input`}
            onClick={() =>
              actions.run.mutate({ call: schedule.call!, input: schedule.input, label })
            }
          >
            <Zap />
            Run now
          </Button>
        )}
      </div>
    </li>
  )
}
