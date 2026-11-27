import { describe, expect, test } from 'bun:test'

import { ADMIN_LOCAL, ISSUES_LOCAL, summary } from './test-fixtures'
import { EAGER_JUDGE_LIMIT, createLimiter, judgedDomains, sourceMark } from './use-facts'

const ticks = async (count: number) => {
  for (let index = 0; index < count; index += 1) await Promise.resolve()
}

/** A task the test finishes by hand, recording when it started. */
function gate(log: string[], name: string) {
  let finish!: () => void
  const done = new Promise<void>((resolve) => (finish = resolve))
  return {
    task: async () => {
      log.push(name)
      await done
      return name
    },
    finish: () => finish(),
  }
}

describe('createLimiter', () => {
  test('runs at most `slots` tasks at once and starts the waiting ones in order', async () => {
    const run = createLimiter(2)
    const log: string[] = []
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((name) => gate(log, name))
    const results = [a, b, c, d].map((entry) => run(entry!.task))
    await ticks(5)
    expect(log).toEqual(['a', 'b'])
    a!.finish()
    await ticks(5)
    expect(log).toEqual(['a', 'b', 'c'])
    b!.finish()
    c!.finish()
    d!.finish()
    expect(await Promise.all(results)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('an urgent task goes ahead of the waiting ones', async () => {
    const run = createLimiter(1)
    const log: string[] = []
    const [first, waiting, urgent] = ['first', 'waiting', 'urgent'].map((name) => gate(log, name))
    const results = [run(first!.task), run(waiting!.task), run(urgent!.task, true)]
    await ticks(5)
    first!.finish()
    await ticks(5)
    expect(log).toEqual(['first', 'urgent'])
    urgent!.finish()
    await ticks(5)
    expect(log).toEqual(['first', 'urgent', 'waiting'])
    waiting!.finish()
    await Promise.all(results)
  })

  test('a failing task frees its slot and keeps its error', async () => {
    const run = createLimiter(1)
    const failing = run(async () => {
      throw new Error('compare failed')
    })
    const next = run(async () => 'next')
    await expect(failing).rejects.toThrow('compare failed')
    expect(await next).toBe('next')
  })

  test('a new task arriving while a slot is handed over never runs beyond the slots', async () => {
    const slots = 2
    const run = createLimiter(slots)
    let active = 0
    let peak = 0
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) % 5
    const submitted: Promise<unknown>[] = []
    for (let index = 0; index < 40; index += 1) {
      const delay = random()
      submitted.push(
        ticks(delay * 3 + (index % 4)).then(() =>
          run(async () => {
            active += 1
            peak = Math.max(peak, active)
            await ticks(random())
            active -= 1
          }, random() === 0),
        ),
      )
    }
    await Promise.all(submitted)
    expect(peak).toBe(slots)
    expect(active).toBe(0)
  })
})

describe('sourceMark', () => {
  test('names what an answer depends on, so an edit on disk is a new question', () => {
    expect(sourceMark(undefined)).toBe('unread')
    expect(sourceMark(ISSUES_LOCAL)).toBe(
      `${ISSUES_LOCAL.revision}|0.8.8|no-git|kernel=${ISSUES_LOCAL.dependencies[0]!.revision},shell=${ISSUES_LOCAL.dependencies[1]!.revision}`,
    )
    const committed = sourceMark({ ...ISSUES_LOCAL, git: { commit: 'abc123', dirty: false } })
    const dirty = sourceMark({ ...ISSUES_LOCAL, git: { commit: 'abc123', dirty: true } })
    expect(committed).toContain('|abc123|')
    expect(dirty).toContain('|abc123+dirty|')
    expect(sourceMark({ ...ISSUES_LOCAL, revision: null, declared: null })).toStartWith(
      'no-revision|no-version|',
    )
    expect(sourceMark({ ...ISSUES_LOCAL, declared: '0.8.9' })).not.toBe(sourceMark(ISSUES_LOCAL))
    expect(
      sourceMark({
        ...ISSUES_LOCAL,
        dependencies: [{ ...ISSUES_LOCAL.dependencies[0]!, revision: 'sha256:other' }],
      }),
    ).not.toBe(sourceMark(ISSUES_LOCAL))
  })
})

describe('judgedDomains', () => {
  const small = [summary('admin', 'admin.astrale.ai'), summary('issues', 'issues.astrale.ai')]
  const large = Array.from({ length: EAGER_JUDGE_LIMIT + 1 }, (_, index) =>
    index === 0
      ? summary('admin', 'admin.astrale.ai')
      : index === 1
        ? summary('issues', 'issues.astrale.ai')
        : summary(`d${index}`, `d${index}.astrale.ai`),
  )
  const locals = [ADMIN_LOCAL, ISSUES_LOCAL]

  test('a small workspace has every Domain judged', () => {
    expect([...judgedDomains(small, locals, undefined, false)]).toEqual(['admin', 'issues'])
  })

  test('a large workspace judges only what the reader asks about', () => {
    expect(judgedDomains(large, locals, undefined, false).size).toBe(0)
    expect([
      ...judgedDomains(large, locals, { kind: 'domain', domainId: 'issues' }, false),
    ]).toEqual(['issues'])
    expect([
      ...judgedDomains(
        large,
        locals,
        { kind: 'dependency', domainId: 'admin', alias: 'shell' },
        false,
      ),
    ]).toEqual(['admin'])
  })

  test('selecting a Domain outside the workspace judges every dependent', () => {
    expect([
      ...judgedDomains(large, locals, { kind: 'origin', origin: 'shell.astrale.ai' }, false),
    ]).toEqual(['admin', 'issues'])
    expect([
      ...judgedDomains(large, locals, { kind: 'origin', origin: 'issues.astrale.ai' }, false),
    ]).toEqual(['admin'])
    expect(
      judgedDomains(large, undefined, { kind: 'origin', origin: 'shell.astrale.ai' }, false).size,
    ).toBe(0)
  })

  test('asking for everything judges every Domain', () => {
    expect(judgedDomains(large, locals, undefined, true).size).toBe(large.length)
  })
})
