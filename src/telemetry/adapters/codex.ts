/**
 * Codex adapter: rollouts live at
 * `<base>/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, date-sharded. Line 1 is
 * a `session_meta` object carrying cwd + session_id + timestamp. Discovery reads
 * only that first line — never the transcript body — and prunes by date shard.
 */
import { existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { HarnessSession } from '../types'
import type { HarnessAdapter, TimeWindow } from './types'

const DAY_MS = 24 * 60 * 60 * 1000
const HEAD_CHUNK = 64 * 1024
// session_meta embeds the harness's full base_instructions — real first lines
// run tens of KB, so read in chunks until the newline (cap = malformed guard).
const MAX_HEAD_BYTES = 512 * 1024

const READING_GUIDE =
  'This is a Codex rollout: one JSON object per line (JSONL). Line 1 is `session_meta` (session_id, ' +
  'timestamp, cwd, cli_version). Later lines are either `response_item` — payload.type of message, ' +
  'function_call, function_call_output, or reasoning (reasoning is a short summary, not verbatim chain ' +
  'of thought) — or `event_msg` carrying task_started, task_complete, token_count, agent_message, and ' +
  'user_message. Files can be large, so grep for function_call names, outputs, or error strings and ' +
  'sample around them rather than reading the whole rollout.'

/** Read the first line of a file without loading the body. */
function readFirstLine(path: string): string | null {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const chunks: Buffer[] = []
    let pos = 0
    while (pos < MAX_HEAD_BYTES) {
      const buf = Buffer.alloc(HEAD_CHUNK)
      const bytes = readSync(fd, buf, 0, HEAD_CHUNK, pos)
      if (bytes === 0) break
      chunks.push(buf.subarray(0, bytes))
      pos += bytes
      // Newline is ASCII, so a byte search is safe; decode only after concat
      // so a multibyte char split across chunks can't corrupt the text.
      if (buf.subarray(0, bytes).includes(0x0a)) break
    }
    const text = Buffer.concat(chunks).toString('utf-8')
    const nl = text.indexOf('\n')
    if (nl !== -1) return text.slice(0, nl)
    return pos >= MAX_HEAD_BYTES ? null : text || null
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

/** Numeric names only (YYYY / MM / DD shards), sorted for determinism. */
function numericDirs(path: string): string[] {
  try {
    return readdirSync(path)
      .filter((n) => /^\d+$/.test(n))
      .sort()
  } catch {
    return []
  }
}

export function codexAdapter(base: string = join(homedir(), '.codex')): HarnessAdapter {
  const sessionsDir = join(base, 'sessions')

  function detect(): boolean {
    try {
      return existsSync(sessionsDir)
    } catch {
      return false
    }
  }

  function discover(root: string, window: TimeWindow): Promise<HarnessSession[]> {
    const sessions: HarnessSession[] = []
    try {
      const startMs = window.start.getTime()
      const endMs = window.end.getTime()
      const lowerMs = startMs - DAY_MS
      for (const yyyy of numericDirs(sessionsDir)) {
        for (const mm of numericDirs(join(sessionsDir, yyyy))) {
          for (const dd of numericDirs(join(sessionsDir, yyyy, mm))) {
            // Shard names are LOCAL dates but dayStart is computed as UTC —
            // pad both bounds a day so no timezone offset can skip a shard.
            const dayStart = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd))
            if (dayStart > endMs + DAY_MS || dayStart + DAY_MS <= lowerMs) continue
            scanDay(join(sessionsDir, yyyy, mm, dd), root, startMs, endMs, sessions)
          }
        }
      }
    } catch {
      return Promise.resolve([])
    }
    return Promise.resolve(sessions)
  }

  return { name: 'codex', detect, discover, readingGuide: READING_GUIDE }
}

function scanDay(
  dayPath: string,
  root: string,
  startMs: number,
  endMs: number,
  out: HarnessSession[],
): void {
  let files: string[]
  try {
    files = readdirSync(dayPath)
  } catch {
    return
  }
  const rootPrefix = `${root}/`
  for (const file of files) {
    if (!file.startsWith('rollout-') || !file.endsWith('.jsonl')) continue
    const transcriptPath = join(dayPath, file)
    try {
      const st = statSync(transcriptPath)
      const mtimeMs = st.mtime.getTime()
      if (mtimeMs < startMs) continue
      const line = readFirstLine(transcriptPath)
      if (line === null) continue
      let meta: unknown
      try {
        meta = JSON.parse(line)
      } catch {
        continue
      }
      const payload = (meta as { payload?: Record<string, unknown> })?.payload
      if (!payload || typeof payload.cwd !== 'string') continue
      const cwd = payload.cwd
      if (cwd !== root && !cwd.startsWith(rootPrefix)) continue
      const startedAt = typeof payload.timestamp === 'string' ? payload.timestamp : undefined
      const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN
      if (!Number.isNaN(startedMs) && startedMs > endMs) continue
      out.push({
        harness: 'codex',
        sessionId: typeof payload.session_id === 'string' ? payload.session_id : undefined,
        transcriptPath,
        cwd,
        startedAt,
        endedAt: st.mtime.toISOString(),
        sizeBytes: st.size,
      })
    } catch {
      /* unreadable rollout — skip it, never fail discovery */
    }
  }
}
