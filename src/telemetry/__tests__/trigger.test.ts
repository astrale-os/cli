import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Set the home before the paths singleton is captured (dynamic imports below).
process.env.ASTRALE_HOME = mkdtempSync(join(tmpdir(), 'astrale-tele-trigger-'))

let maybeTriggerAnalysis: (argv: string[]) => void
let sessionDir: (id: string) => string

beforeAll(async () => {
  ;({ maybeTriggerAnalysis } = await import('../trigger'))
  ;({ sessionDir } = await import('../store'))
  // Sibling test files mutate these in the shared bun process — own them here.
  delete process.env.ASTRALE_TELEMETRY
  delete process.env.ASTRALE_TELEMETRY_NO_TRIGGER
})

function seed(id: string, ageMs: number, analyzed: boolean): void {
  const dir = sessionDir(id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id, root: '/w', explicit: false }))
  writeFileSync(join(dir, 'events.jsonl'), '{}\n')
  if (analyzed) {
    writeFileSync(
      join(dir, '.analyzed'),
      JSON.stringify({ analyzedAt: new Date().toISOString(), outcome: 'reported' }),
    )
  }
  const when = new Date(Date.now() - ageMs)
  utimesSync(join(dir, 'events.jsonl'), when, when)
}

describe('opportunistic GC', () => {
  test('removes analyzed sessions past retention, keeps recent and unanalyzed ones', () => {
    const DAY = 24 * 60 * 60 * 1000
    seed('gc-old-analyzed', 40 * DAY, true)
    seed('gc-recent-analyzed', 2 * DAY, true)
    // NOTE: no closed-unanalyzed sessions seeded — the trigger must find no
    // analysis target, so this test never spawns a child process.
    maybeTriggerAnalysis(['bun', 'astrale', 'status'])
    expect(existsSync(sessionDir('gc-old-analyzed'))).toBe(false)
    expect(existsSync(sessionDir('gc-recent-analyzed'))).toBe(true)
  })
})
