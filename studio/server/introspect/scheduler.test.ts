import { expect, test } from 'bun:test'

import { IntrospectionScheduler } from './scheduler'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  return {
    promise: new Promise<void>((done) => (resolve = done)),
    resolve,
  }
}

/** Let the scheduler's queued microtask and the promises it starts settle. */
const turn = () => new Promise<void>((resolve) => queueMicrotask(resolve))

test('never runs more than two introspections at once', async () => {
  const scheduler = new IntrospectionScheduler(2)
  const releases = [deferred(), deferred(), deferred(), deferred()]
  let active = 0
  let peak = 0
  const jobs = releases.map((release, index) =>
    scheduler.schedule(`domain-${index}`, 'background', async () => {
      active++
      peak = Math.max(peak, active)
      await release.promise
      active--
    }),
  )

  await turn()
  expect(scheduler.snapshot()).toMatchObject({
    concurrency: 2,
    active: ['domain-0', 'domain-1'],
    queued: { background: ['domain-2', 'domain-3'] },
  })
  releases[0]!.resolve()
  releases[1]!.resolve()
  await turn()
  await turn()
  releases[2]!.resolve()
  releases[3]!.resolve()
  await Promise.all(jobs.map(({ promise }) => promise))

  expect(peak).toBe(2)
})

test('a visible Domain overtakes queued background indexing', async () => {
  const scheduler = new IntrospectionScheduler(1)
  const first = deferred()
  const order: string[] = []
  const running = scheduler.schedule('running', 'background', async () => {
    await first.promise
    order.push('running')
  })
  const waiting = scheduler.schedule('waiting', 'background', () => {
    order.push('waiting')
  })
  const visible = scheduler.schedule('visible', 'background', () => {
    order.push('visible')
  })

  await turn()
  visible.promote()
  first.resolve()
  await Promise.all([running.promise, waiting.promise, visible.promise])

  expect(order).toEqual(['running', 'visible', 'waiting'])
})
