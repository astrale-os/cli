import { afterEach, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { captureCommand } from './process'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function hangingCommand(root: string): string {
  const file = join(root, 'hang')
  writeFileSync(file, '#!/usr/bin/env bun\nsetInterval(() => {}, 1000)\n')
  chmodSync(file, 0o755)
  return file
}

test('a hanging probe is bounded by its timeout, and setup cancellation aborts it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-harness-process-'))
  roots.push(root)
  const hang = hangingCommand(root)
  expect(await captureCommand(hang, [], root, { timeoutMs: 30 })).toMatchObject({
    code: -1,
    timedOut: true,
    stderr: 'command timed out after 30ms',
  })

  const controller = new AbortController()
  const pending = captureCommand(hang, [], root, { signal: controller.signal, timeoutMs: 5_000 })
  controller.abort()
  expect(await pending).toMatchObject({ code: -1, aborted: true, stderr: 'canceled' })
})
