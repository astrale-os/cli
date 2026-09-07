import type { StaleReport } from '@shared/types'

import { ArrowUpCircle, Copy } from 'lucide-react'
import { toast } from 'sonner'

import { useUpdates } from '@/lib/hooks'

import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

/**
 * The running Studio is embedded in the CLI executable it would replace. A
 * self-update can swap the file on disk, but it cannot replace this process,
 * its supervised server, and active agent streams atomically. Keep the Studio
 * side read-only: show exactly what is stale and hand the update to a terminal,
 * where stopping and relaunching Studio is explicit.
 */
export function UpdatesBadge({ domainId, domainPath }: { domainId: string; domainPath: string }) {
  const { data } = useUpdates(domainId)

  if (!(data && actionable(data))) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${summarize(data)} — open update instructions`}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
        >
          <ArrowUpCircle className="h-3.5 w-3.5" />
          <span>Update</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-80 space-y-3 p-3">
        <UpdateInstructions report={data} domainPath={domainPath} />
      </PopoverContent>
    </Popover>
  )
}

/** Kept separate from the Radix portal so its copy and lifecycle contract is easy to verify. */
export function UpdateInstructions({
  report,
  domainPath,
}: {
  report: StaleReport
  domainPath: string
}) {
  const command = updateCommand(domainPath, report)

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(command)
      toast.success('Update command copied')
    } catch {
      toast.error('Copy failed — select the command and copy it manually')
    }
  }

  return (
    <>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Update available
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Studio runs inside Astrale, so update it after stopping this Studio.
        </p>
      </div>

      <UpdateDetails report={report} />

      <div className="rounded-md border bg-muted/40 p-2">
        <code className="block overflow-x-auto whitespace-nowrap font-mono text-[11px] leading-5 text-foreground">
          {command}
        </code>
      </div>

      <Button size="sm" className="w-full" onClick={copy} aria-label="Copy update command">
        <Copy />
        Copy command
      </Button>

      <p className="text-[11px] leading-4 text-muted-foreground">
        Copy it, stop Studio with Ctrl-C, run it in your terminal, then relaunch your previous{' '}
        <code className="font-mono text-foreground/80">astrale studio</code> command.
      </p>
    </>
  )
}

function UpdateDetails({ report }: { report: StaleReport }) {
  const { cli, skills, sdk } = report
  return (
    <div className="space-y-1.5 rounded-md border border-warning/20 bg-warning/[0.04] p-2">
      {cli.stale && !cli.managed ? (
        <UpdateDetail
          label="Astrale CLI"
          value={`${cli.current ?? '?'} → ${cli.latest ?? '?'}${cli.channel ? ` (${cli.channel})` : ''}`}
        />
      ) : null}
      {skills.status === 'update-available' || skills.status === 'repair-needed' ? (
        <UpdateDetail
          label="Astrale skills"
          value={skills.status === 'repair-needed' ? 'Repair needed' : 'Update available'}
        />
      ) : null}
      {sdk.outdated.map((item) => (
        <UpdateDetail
          key={item.pkg}
          label={item.pkg}
          value={`${item.current} → ${item.latest}`}
          mono
        />
      ))}
    </div>
  )
}

function UpdateDetail({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <span
        className={
          mono ? 'min-w-0 truncate font-mono text-foreground' : 'font-medium text-foreground'
        }
      >
        {label}
      </span>
      <span className="shrink-0 font-mono text-muted-foreground">{value}</span>
    </div>
  )
}

/** A POSIX-shell command safe for domain paths containing spaces or quotes. */
export function updateCommand(domainPath: string, report: StaleReport): string {
  const install = report.sdk.stale ? ' && pnpm install' : ''
  return `cd ${shellQuote(domainPath)} && astrale update${install}`
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

/** Package-managed CLIs cannot be replaced by `astrale update`; don't offer a dead end. */
export function actionable(report: StaleReport): boolean {
  return (
    (report.cli.stale && !report.cli.managed) ||
    report.skills.status === 'update-available' ||
    report.skills.status === 'repair-needed' ||
    report.sdk.stale
  )
}

function summarize(report: StaleReport): string {
  const parts: string[] = []
  if (report.cli.stale && !report.cli.managed) {
    parts.push(`Astrale CLI ${report.cli.current ?? '?'} → ${report.cli.latest ?? '?'}`)
  }
  if (report.skills.status === 'update-available') parts.push('Astrale skills update')
  if (report.skills.status === 'repair-needed') parts.push('Astrale skills repair')
  if (report.sdk.stale) {
    const count = report.sdk.outdated.length
    parts.push(`${count} SDK package${count === 1 ? '' : 's'}`)
  }
  return parts.length > 0 ? `Update available: ${parts.join(' · ')}` : 'Update available'
}
