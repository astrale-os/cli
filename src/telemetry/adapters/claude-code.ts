/**
 * Claude Code adapter: transcripts live at
 * `<base>/projects/<munged-cwd>/<session-uuid>.jsonl`, where the project dir is
 * the absolute cwd with every non-alphanumeric char replaced by '-'. Discovery
 * is stat/readdir only — it never opens a transcript.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { HarnessSession } from '../types'
import type { HarnessAdapter, TimeWindow } from './types'

/** cwd → project dir name: every non-alphanumeric char becomes '-'. */
function mungeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

const READING_GUIDE =
  'This is a Claude Code transcript: one JSON object per line (JSONL). Each entry has a `type` ' +
  '(user, assistant, system, file-history-snapshot, …). Assistant entries carry the model’s ' +
  'verbatim `thinking` blocks plus `tool_use` blocks with full tool inputs; tool results come back as ' +
  'user-type entries. Files are large and append-only, so grep for tool names, error strings, or file ' +
  'paths and sample the surrounding lines rather than reading the whole transcript. The last line ' +
  'reflects where the session ended.'

export function claudeCodeAdapter(base: string = join(homedir(), '.claude')): HarnessAdapter {
  const projectsDir = join(base, 'projects')

  function detect(): boolean {
    try {
      return existsSync(projectsDir)
    } catch {
      return false
    }
  }

  function discover(root: string, window: TimeWindow): Promise<HarnessSession[]> {
    const sessions: HarnessSession[] = []
    try {
      const munged = mungeCwd(root)
      const prefix = `${munged}-`
      let dirs: string[]
      try {
        dirs = readdirSync(projectsDir)
      } catch {
        return Promise.resolve([])
      }
      const startMs = window.start.getTime()
      const endMs = window.end.getTime()
      for (const dir of dirs) {
        if (dir !== munged && !dir.startsWith(prefix)) continue
        const projectPath = join(projectsDir, dir)
        let files: string[]
        try {
          files = readdirSync(projectPath)
        } catch {
          continue
        }
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue
          const transcriptPath = join(projectPath, file)
          try {
            const st = statSync(transcriptPath)
            const mtimeMs = st.mtime.getTime()
            const birthMs = st.birthtime.getTime()
            const spanStart = Math.min(birthMs, mtimeMs)
            const spanEnd = Math.max(birthMs, mtimeMs)
            if (spanStart > endMs || spanEnd < startMs) continue
            sessions.push({
              harness: 'claude-code',
              sessionId: file.slice(0, -'.jsonl'.length),
              transcriptPath,
              sizeBytes: st.size,
              startedAt: st.birthtime.toISOString(),
              endedAt: st.mtime.toISOString(),
            })
          } catch {
            /* unreadable transcript — skip it, never fail discovery */
          }
        }
      }
    } catch {
      return Promise.resolve([])
    }
    return Promise.resolve(sessions)
  }

  return { name: 'claude-code', detect, discover, readingGuide: READING_GUIDE }
}
