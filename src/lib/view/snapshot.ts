import type { AbResult } from '../browser'

const SETTLE_TIMEOUT_MS = 8_000
const QUIET_WINDOW_MS = 750
const POLL_MS = 250

type SettleClock = {
  now(): number
  sleep(ms: number): Promise<void>
}

type SettlePolicy = {
  timeoutMs: number
  quietWindowMs: number
  pollMs: number
}

const realClock: SettleClock = {
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

const defaultPolicy: SettlePolicy = {
  timeoutMs: SETTLE_TIMEOUT_MS,
  quietWindowMs: QUIET_WINDOW_MS,
  pollMs: POLL_MS,
}

export function snapshotText(result: AbResult): string | null {
  const data = result.data as { snapshot?: unknown } | string | null
  if (typeof data === 'string') return data
  return typeof data?.snapshot === 'string' ? data.snapshot : null
}

function isMeaningfulSnapshot(text: string): boolean {
  return /"[^"\n]+"/.test(text)
}

function isPendingSnapshot(text: string): boolean {
  if (/\[[^\]]*\bbusy\b[^\]]*\]/i.test(text)) return true
  if (/^\s*-\s*progressbar\b/im.test(text)) return true

  // Views often render loading text without aria-busy. The timeout still
  // returns that snapshot when a view never leaves its loading state.
  return /"(?:loading|opening|connecting|initializing|preparing|starting|fetching|refreshing|please wait)(?:\b[^"\n]{0,100})?"/i.test(
    text,
  )
}

function fingerprint(text: string): string {
  return text
    .replace(/\bref=e\d+\b/g, 'ref')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Warm the cross-origin accessibility tree, then wait for a meaningful view
 * snapshot to remain unchanged briefly. Loading/busy states never settle
 * early, but the timeout returns their latest snapshot for diagnosis.
 */
export async function waitForSettledSnapshot(
  takeSnapshot: () => Promise<AbResult>,
  clock: SettleClock = realClock,
  policy: SettlePolicy = defaultPolicy,
): Promise<AbResult> {
  let lastAttempt = await takeSnapshot()
  let lastSuccess = lastAttempt.ok ? lastAttempt : null
  let stableFingerprint: string | null = null
  let stableSince = clock.now()
  const deadline = clock.now() + policy.timeoutMs

  while (true) {
    lastAttempt = await takeSnapshot()
    const sampledAt = clock.now()

    if (lastAttempt.ok) {
      lastSuccess = lastAttempt
      const text = snapshotText(lastAttempt)
      if (text && isMeaningfulSnapshot(text)) {
        const nextFingerprint = fingerprint(text)
        if (nextFingerprint !== stableFingerprint) {
          stableFingerprint = nextFingerprint
          stableSince = sampledAt
        } else if (!isPendingSnapshot(text) && sampledAt - stableSince >= policy.quietWindowMs) {
          return lastAttempt
        }
      } else {
        stableFingerprint = null
        stableSince = sampledAt
      }
    } else {
      stableFingerprint = null
      stableSince = sampledAt
    }

    const remaining = deadline - clock.now()
    if (remaining <= 0) return lastSuccess ?? lastAttempt
    await clock.sleep(Math.min(policy.pollMs, remaining))
  }
}
