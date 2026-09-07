/**
 * One process-wide gate around schema work.
 *
 * Startup indexing and browser reads used to own separate concurrency policies:
 * boot limited itself to two jobs, while a page could still start a build for
 * every Domain it queried. This scheduler is the shared boundary both paths use.
 */

import type { IntrospectionPriority } from '../../shared/types'

export interface SchedulerSnapshot {
  readonly concurrency: number
  readonly active: readonly string[]
  readonly queued: {
    readonly reader: readonly string[]
    readonly background: readonly string[]
  }
}

export interface ScheduledWork<T> {
  readonly promise: Promise<T>
  /** Move work that has not started yet ahead of background indexing. */
  promote(): void
}

interface Job<T = unknown> {
  readonly label: string
  readonly run: () => Promise<T> | T
  readonly resolve: (value: T | PromiseLike<T>) => void
  readonly reject: (reason?: unknown) => void
  readonly queuedAt: number
  readonly onStart?: (waitMs: number) => void
  priority: IntrospectionPriority
  started: boolean
}

export class IntrospectionScheduler {
  readonly concurrency: number
  private active = new Set<Job>()
  private readers: Job[] = []
  private background: Job[] = []
  private drainQueued = false

  constructor(concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('introspection concurrency must be a positive integer')
    }
    this.concurrency = concurrency
  }

  schedule<T>(
    label: string,
    priority: IntrospectionPriority,
    run: () => Promise<T> | T,
    onStart?: (waitMs: number) => void,
  ): ScheduledWork<T> {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    const job: Job<T> = {
      label,
      priority,
      run,
      resolve,
      reject,
      queuedAt: performance.now(),
      ...(onStart ? { onStart } : {}),
      started: false,
    }
    this.queue(priority).push(job as Job)
    this.requestDrain()

    return {
      promise,
      promote: () => {
        if (job.started || job.priority === 'reader') return
        const index = this.background.indexOf(job as Job)
        if (index < 0) return
        this.background.splice(index, 1)
        job.priority = 'reader'
        this.readers.push(job as Job)
        this.requestDrain()
      },
    }
  }

  snapshot(): SchedulerSnapshot {
    return {
      concurrency: this.concurrency,
      active: [...this.active].map(({ label }) => label),
      queued: {
        reader: this.readers.map(({ label }) => label),
        background: this.background.map(({ label }) => label),
      },
    }
  }

  private queue(priority: IntrospectionPriority): Job[] {
    return priority === 'reader' ? this.readers : this.background
  }

  private requestDrain(): void {
    if (this.drainQueued) return
    this.drainQueued = true
    queueMicrotask(() => {
      this.drainQueued = false
      this.drain()
    })
  }

  private drain(): void {
    while (this.active.size < this.concurrency) {
      const job = this.readers.shift() ?? this.background.shift()
      if (!job) return
      job.started = true
      this.active.add(job)
      job.onStart?.(performance.now() - job.queuedAt)
      Promise.resolve()
        .then(job.run)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active.delete(job)
          this.requestDrain()
        })
    }
  }
}

export const introspectionScheduler = new IntrospectionScheduler(2)
