import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runExtractorIsland } from './introspect/runtime'
import { captureProcess, createChildRunner, operandProblem } from './process'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function folder(): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-process-'))
  roots.push(root)
  return root
}

/** A child that notes when it starts and ends in `log`, and takes `ms`. */
const noting = (log: string, name: string, ms: number): string[] => [
  '/bin/sh',
  '-c',
  `echo "start ${name}" >> "${log}"; sleep ${ms / 1000}; echo "end ${name}" >> "${log}"`,
]

const lines = (log: string): string[] =>
  existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []

async function stopped(pid: number): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await Bun.sleep(10)
  }
  return false
}

test('at most `running` children run at once; the next waits in arrival order, its deadline from its start', async () => {
  const log = join(folder(), 'log')
  const run = createChildRunner({ running: 2, waiting: 4 })
  // the third waits 200 ms for a slot, longer than its own 150 ms budget would allow were it counted
  const runs = [
    run(noting(log, 'a', 200), { timeoutMs: 5_000 }),
    run(noting(log, 'b', 200), { timeoutMs: 5_000 }),
    run(noting(log, 'c', 50), { timeoutMs: 150 }),
    run(noting(log, 'd', 50), { timeoutMs: 5_000 }),
  ]
  const answers = await Promise.all(runs)
  expect(answers.map((answer) => [answer.exitCode, answer.timedOut])).toEqual([
    [0, false],
    [0, false],
    [0, false],
    [0, false],
  ])
  const order = lines(log)
  // c and d start only once a and b have both been running; neither starts before an end
  expect(order.slice(0, 2).sort()).toEqual(['start a', 'start b'])
  expect(order.indexOf('start c')).toBeGreaterThan(
    order.findIndex((line) => line.startsWith('end')),
  )
  expect(order.indexOf('start c')).toBeLessThan(order.indexOf('start d'))
})

test('one more than `waiting` is refused at once, and a caller that gives up leaves the queue', async () => {
  const log = join(folder(), 'log')
  const run = createChildRunner({ running: 1, waiting: 1 })
  const first = run(noting(log, 'a', 150), { timeoutMs: 5_000 })
  const controller = new AbortController()
  const waiting = run(noting(log, 'b', 10), { timeoutMs: 5_000, signal: controller.signal })
  expect(await run(noting(log, 'c', 10), { timeoutMs: 5_000 })).toMatchObject({
    exitCode: -1,
    spawnError: 'the Studio already runs 1 processes and 1 wait: try again',
  })
  controller.abort()
  expect(await waiting).toMatchObject({ exitCode: -1, aborted: true })
  // the place it left is free again
  const next = run(noting(log, 'd', 10), { timeoutMs: 5_000 })
  await Promise.all([first, next])
  expect(lines(log)).toEqual(['start a', 'end a', 'start d', 'end d'])
})

test('every child names a deadline and a command', async () => {
  expect(await captureProcess(['true'], { timeoutMs: 0 })).toMatchObject({
    exitCode: -1,
    spawnError: 'a child runs within a deadline',
  })
  expect(await captureProcess([], { timeoutMs: 1_000 })).toMatchObject({
    spawnError: 'no command to run',
  })
})

test('an extractor island past its deadline is killed with the children it started', async () => {
  const root = folder()
  const pids = join(root, 'pids.json')
  const island = join(root, 'island.ts')
  writeFileSync(
    island,
    `
    import { spawn } from 'node:child_process'
    import { writeFileSync } from 'node:fs'
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'inherit' })
    writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.pid, child.pid]))
    process.on('SIGTERM', () => {})
    process.stderr.write('working\\n')
    setInterval(() => {}, 1000)
  `,
  )
  const previous = process.env.DOMAIN_STUDIO_CLI_DESCRIPTOR
  delete process.env.DOMAIN_STUDIO_CLI_DESCRIPTOR
  try {
    await expect(runExtractorIsland('__studio-extractor', island, [], 500)).rejects.toThrow(
      'the extractor did not answer within 500ms',
    )
  } finally {
    if (previous !== undefined) process.env.DOMAIN_STUDIO_CLI_DESCRIPTOR = previous
  }
  const started = JSON.parse(readFileSync(pids, 'utf8')) as number[]
  expect(started).toHaveLength(2)
  for (const pid of started) expect(await stopped(pid)).toBe(true)
})

test('a value that would read as an option is no operand', () => {
  expect(operandProblem('-rf', 'the instance name')).toBe(
    'the instance name "-rf" starts with "-", which a command reads as an option',
  )
  expect(operandProblem('--instance=prod', 'the instance name')).toContain('starts with "-"')
  expect(operandProblem('', 'the instance name')).toBe('the instance name is empty')
  expect(operandProblem('astrale-01', 'the instance name')).toBeUndefined()
})
