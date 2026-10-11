/**
 * Claude Code keeps transcripts at `<base>/projects/<munged-cwd>/<session-uuid>.jsonl`, where the
 * project directory is the absolute cwd with every non-alphanumeric character replaced by '-'.
 * Discovery only stats; it never opens a transcript.
 */
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { HarnessSession } from '../types'
import type { HarnessAdapter, TimeWindow } from './index'

const READING_GUIDE =
  'This is a Claude Code transcript: one JSON object per line (JSONL). Each entry has a `type` ' +
  '(user, assistant, system, file-history-snapshot, …). Assistant entries carry the model’s ' +
  'verbatim `thinking` blocks plus `tool_use` blocks with full tool inputs; tool results come back as ' +
  'user-type entries. Files are large and append-only, so grep for tool names, error strings, or file ' +
  'paths and sample the surrounding lines rather than reading the whole transcript. The last line ' +
  'reflects where the session ended.'

function readdir(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

export function claudeCodeAdapter(base: string = join(homedir(), '.claude')): HarnessAdapter {
  const projectsDir = join(base, 'projects')

  function discover(root: string, window: TimeWindow): HarnessSession[] {
    const munged = root.replace(/[^a-zA-Z0-9]/g, '-')
    const sessions: HarnessSession[] = []
    for (const dir of readdir(projectsDir)) {
      if (dir !== munged && !dir.startsWith(`${munged}-`)) continue
      for (const file of readdir(join(projectsDir, dir))) {
        if (!file.endsWith('.jsonl')) continue
        const transcriptPath = join(projectsDir, dir, file)
        const stat = statSync(transcriptPath, { throwIfNoEntry: false })
        if (!stat) continue
        const spanStart = Math.min(stat.birthtimeMs, stat.mtimeMs)
        const spanEnd = Math.max(stat.birthtimeMs, stat.mtimeMs)
        if (spanStart > window.end.getTime() || spanEnd < window.start.getTime()) continue
        sessions.push({
          harness: 'claude-code',
          sessionId: file.slice(0, -'.jsonl'.length),
          transcriptPath,
          sizeBytes: stat.size,
          startedAt: stat.birthtime.toISOString(),
          endedAt: stat.mtime.toISOString(),
        })
      }
    }
    return sessions
  }

  return { name: 'claude-code', discover, readingGuide: READING_GUIDE }
}
