import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { tailLog } from '../up'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'astrale-tail-'))
}

describe('tailLog — mtime gate (show only logs written this run)', () => {
  test('returns the tail when the log is newer than sinceMs (spawn-phase failure)', () => {
    const dir = tmp()
    try {
      writeFileSync(join(dir, 'wrangler.log'), 'line1\n[wrangler:info] Ready on :8899\n')
      const out = tailLog(dir, Date.now() - 60_000) // run started a minute ago; log is newer
      expect(out).toContain('wrangler.log:')
      expect(out).toContain('Ready on :8899')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('suppresses a STALE log older than sinceMs (the pre-spawn case)', () => {
    const dir = tmp()
    try {
      const p = join(dir, 'wrangler.log')
      writeFileSync(p, 'fatal error: all goroutines are asleep - deadlock!\n')
      const old = new Date(Date.now() - 3 * 60 * 60_000) // 3h ago
      utimesSync(p, old, old)
      expect(tailLog(dir, Date.now())).toBeUndefined() // run started now → log is stale
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns undefined when no log file exists', () => {
    const dir = tmp()
    try {
      expect(tailLog(dir, 0)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
