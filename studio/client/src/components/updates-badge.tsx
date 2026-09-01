import type { StaleReport } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpCircle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { useUpdates } from '@/lib/hooks'

/**
 * The header "Update" chip — rendered ONLY when the Astrale skills or an
 * @astrale-os/* SDK dep is behind, or when a CLI that Studio can actually replace
 * is (invisible when everything is current, and when the only stale axis is a
 * package-managed binary Studio cannot touch). The check is the CLI's own
 * `astrale update --check --json` (via /api/domain/:id/updates).
 *
 * Clicking it IS the update: it runs `astrale update --yes` in the domain root
 * and reports the verdict as a toast — no panel, no CLI transcript. On success we
 * re-check, so the chip clears itself.
 */
export function UpdatesBadge({ domainId }: { domainId: string }) {
  const { data } = useUpdates(domainId)
  const qc = useQueryClient()
  const [running, setRunning] = useState(false)

  // Stay mounted while an update is in flight, even once the re-check has already
  // cleared `stale` — otherwise the chip vanishes mid-run.
  if (!running && !(data && actionable(data))) return null

  const run = async () => {
    if (running) return
    setRunning(true)
    try {
      const result = await api.applyUpdate(domainId)
      if (result.ok) toast.success('Astrale updated')
      else toast.error(result.error || 'Update failed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setRunning(false)
      qc.invalidateQueries({ queryKey: qk.updates(domainId) })
    }
  }

  return (
    <button
      type="button"
      title={data ? summarize(data) : 'Update available'}
      disabled={running}
      onClick={run}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 text-xs font-medium text-warning transition-colors hover:bg-warning/20 disabled:opacity-70"
    >
      {running ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ArrowUpCircle className="h-3.5 w-3.5" />
      )}
      <span>{running ? 'Updating…' : 'Update'}</span>
    </button>
  )
}

/**
 * Is there anything `astrale update --yes` could actually fix? A stale binary that
 * the CLI reports as externally managed (installed by a package manager) is not:
 * it warns and refuses, so offering the chip would only ever be a dead end.
 */
function actionable(report: StaleReport): boolean {
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
