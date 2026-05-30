import chalk from 'chalk'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel/types'

import { withKernelClient } from '../../kernel/client'
import { KERNEL_PASSTHROUGH_OPTIONS } from '../../kernel/options'
import { readConfig } from '../../lib/config'
import { getDefault } from '../../lib/identity'
import { resolveInstanceId } from '../../lib/instance'
import { fatal } from '../../lib/log'
import { isRawOutput, output, RAW_OUTPUT_OPTIONS } from '../../lib/output'
import { JOURNAL_PATH, LOGS_DIR } from '../../lib/paths'

type WhoamiOpts = KernelCommandOpts & {
  raw?: boolean
  json?: boolean
}

type WhoamiResult = {
  name: string
  subject: string
  /** Resolved principal id on the target kernel. Only set when `-i`/`--url` is given. */
  principal?: string
}

// Journal flushes are async — poll for the kernel to land our probe event.
// 10×50ms ≈ 500ms total; in practice the event is visible after the first
// retry. Bumping the budget hides genuine kernel issues.
const JOURNAL_POLL_ATTEMPTS = 10
const JOURNAL_POLL_INTERVAL_MS = 50
// Tolerance for clock skew between the CLI's `Date.now()` and the
// kernel-stamped event timestamp when bounding the backwards walk.
const CLOCK_SKEW_MS = 100

/**
 * Show the local default identity. With `-i <instance>` (or `--url`), also
 * report the principal id the target kernel resolves the caller to — useful
 * for `grantPerm` (the principal id is what permissions are granted to) and
 * for "who does this kernel see me as?" debugging.
 *
 * Resolution: a probe call (`/::listChildren`) generates an event in the
 * kernel's journal; we then read the latest matching entry's
 * `metadata.principal`. No kernel-side schema changes needed.
 */
export default {
  name: 'whoami',
  description:
    'Show the current default identity (with -i, also report the kernel-resolved principal)',
  options: [...RAW_OUTPUT_OPTIONS, ...KERNEL_PASSTHROUGH_OPTIONS],
  action: async (opts: WhoamiOpts) => {
    try {
      const isRaw = isRawOutput(opts)
      const identity = await getDefault()
      const result: WhoamiResult = {
        name: identity.name,
        subject: identity.subject,
      }

      if (opts.instance !== undefined || opts.url !== undefined) {
        result.principal = await resolveKernelPrincipal(opts)
      }

      if (isRaw) {
        output(result, opts)
        return
      }
      console.log(`${chalk.bold(result.name)} (subject: ${result.subject})`)
      if (result.principal !== undefined) {
        console.log(`  ${chalk.dim('on kernel:')} principal=${chalk.cyan(result.principal)}`)
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition

/**
 * Probe the target kernel with a cheap authenticated call, then read the
 * resulting event from the local journal to extract the resolved principal.
 *
 * Returns `undefined` (not throw) when the probe call fails or the journal
 * doesn't carry the expected entry — callers treat the principal field as
 * best-effort metadata.
 */
async function resolveKernelPrincipal(opts: WhoamiOpts): Promise<string | undefined> {
  const probeStart = Date.now()
  try {
    await withKernelClient(opts, async (ctx) => {
      await ctx.client.call('/::listChildren', {})
    })
  } catch {
    return undefined
  }

  const config = await readConfig()
  const instanceId = await resolveInstanceId(opts, config)
  const journalPath = instanceId ? join(LOGS_DIR, instanceId, 'events.ndjson') : JOURNAL_PATH

  let lastSize = -1
  for (let attempt = 0; attempt < JOURNAL_POLL_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, JOURNAL_POLL_INTERVAL_MS))
    const size = await safeFileSize(journalPath)
    if (size === lastSize) continue
    lastSize = size
    const principal = await readPrincipalFromTail(journalPath, probeStart)
    if (principal) return principal
  }
  return undefined
}

async function safeFileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return -1
  }
}

type JournalEntry = {
  event?: {
    topic?: string
    metadata?: { timestamp?: number; principal?: string }
  }
}

/**
 * Read the journal's tail and walk backwards looking for our probe's
 * `listChildren:completed` entry. Bounded by `sinceMs` (with clock-skew
 * tolerance) so we stop before the entire history gets re-parsed.
 */
async function readPrincipalFromTail(path: string, sinceMs: number): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, 'r')
  } catch {
    return undefined
  }
  try {
    const { size } = await handle.stat()
    const tailSize = Math.min(size, 64 * 1024)
    const buf = Buffer.alloc(tailSize)
    await handle.read(buf, 0, tailSize, size - tailSize)
    const lines = buf.toString('utf-8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]
      if (!line) continue
      let entry: JournalEntry
      try {
        entry = JSON.parse(line) as JournalEntry
      } catch {
        continue
      }
      const ts = entry.event?.metadata?.timestamp
      if (typeof ts === 'number' && ts < sinceMs - CLOCK_SKEW_MS) return undefined
      const topic = entry.event?.topic ?? ''
      if (topic.includes('listChildren') && topic.endsWith(':completed')) {
        return entry.event?.metadata?.principal
      }
    }
    return undefined
  } finally {
    await handle.close()
  }
}
