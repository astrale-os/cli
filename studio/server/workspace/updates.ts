/**
 * Workspace update bridge for the header Update badge.
 *
 * We don't reimplement staleness: the `astrale` CLI owns it. `astrale update
 * --check --json`, run in the DOMAIN ROOT (so its @astrale-os/* SDK-dep axis sees
 * THIS project), emits a unified `{ stale, cli, skills, sdk }` report. We run it with
 * stdout piped and read it regardless of exit code — a stale result exits 10 by
 * design, which is not an error here. Best-effort: anything unexpected (no
 * bad output) collapses to "nothing stale" so the badge stays
 * hidden rather than nagging on a hiccup.
 */
import type { StaleReport } from '../../shared/types'

import { decodeJsonObject, runStudioCliJson, runStudioCliText } from '../cli'

const NOT_STALE: StaleReport = {
  stale: false,
  cli: { stale: false, managed: true },
  skills: { status: 'current' },
  sdk: { stale: false, inProject: false, outdated: [] },
}

export async function getUpdates(root: string): Promise<StaleReport> {
  const result = await runStudioCliJson(['update', '--check', '--json'], decodeStaleReport, {
    cwd: root,
    acceptedExitCodes: [0, 10],
  })
  return result.ok && result.data ? result.data : NOT_STALE
}

function decodeStaleReport(value: unknown): StaleReport | null {
  const report = decodeJsonObject(value)
  const cli = decodeJsonObject(report?.cli)
  const skills = decodeJsonObject(report?.skills)
  const sdk = decodeJsonObject(report?.sdk)
  if (
    typeof report?.stale !== 'boolean' ||
    typeof cli?.stale !== 'boolean' ||
    typeof cli.managed !== 'boolean' ||
    typeof sdk?.stale !== 'boolean' ||
    typeof sdk.inProject !== 'boolean' ||
    !Array.isArray(sdk.outdated)
  ) {
    return null
  }
  const outdated = sdk.outdated.flatMap((value) => {
    const item = decodeJsonObject(value)
    return typeof item?.pkg === 'string' &&
      typeof item.current === 'string' &&
      typeof item.latest === 'string'
      ? [{ pkg: item.pkg, current: item.current, latest: item.latest }]
      : []
  })
  if (outdated.length !== sdk.outdated.length) return null
  const skillStatuses = new Set([
    'current',
    'update-available',
    'repair-needed',
    'unavailable',
    'skipped',
  ])
  // Additive compatibility: Studio can briefly run a newer server against an
  // older CLI report while a binary update is being applied.
  const skillStatus =
    skills === null || skills === undefined
      ? 'current'
      : typeof skills.status === 'string' && skillStatuses.has(skills.status)
        ? (skills.status as StaleReport['skills']['status'])
        : null
  if (skillStatus === null) return null
  return {
    stale: report.stale,
    cli: {
      stale: cli.stale,
      managed: cli.managed,
      ...(typeof cli.current === 'string' ? { current: cli.current } : {}),
      ...(typeof cli.latest === 'string' ? { latest: cli.latest } : {}),
      ...(typeof cli.channel === 'string' ? { channel: cli.channel } : {}),
    },
    skills: {
      status: skillStatus,
      ...(typeof skills?.error === 'string' ? { error: skills.error } : {}),
    },
    sdk: { stale: sdk.stale, inProject: sdk.inProject, outdated },
  }
}

export interface UpdateApplyResult {
  ok: boolean
  output: string
}

/**
 * Apply the update for the header "Update now" button — `astrale update --yes`,
 * run in the domain root. The CLI does the work non-interactively and resiliently
 * (binary + skills + SDK deps; a binary that can't self-update warns but doesn't
 * block the others), so we just spawn it and capture the combined output to show.
 */
export async function applyUpdates(root: string): Promise<UpdateApplyResult> {
  const result = await runStudioCliText(['update', '--yes'], { cwd: root })
  return {
    ok: result.ok,
    output: `${result.stdout}${result.stderr}`.trim() || result.detail,
  }
}
