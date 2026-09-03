import type {
  DomainIntrospectionTiming,
  IntrospectionPhase,
  IntrospectionPriority,
} from '../../shared/types'

const latest = new Map<string, IntrospectionTimer>()

const rounded = (duration: number) => Math.round(duration * 10) / 10

/** One queued bundle read, from admission through cache or extraction. */
export class IntrospectionTimer {
  readonly domainId: string
  private priority: IntrospectionPriority
  private status: DomainIntrospectionTiming['status'] = 'queued'
  private phase: IntrospectionPhase = 'queued'
  private readonly queuedAt = new Date()
  private readonly queuedClock = performance.now()
  private startedAt?: Date
  private completedAt?: Date
  private phasesMs: Partial<Record<IntrospectionPhase, number>> = {}
  private result?: DomainIntrospectionTiming['result']
  private error?: string

  constructor(domainId: string, priority: IntrospectionPriority) {
    this.domainId = domainId
    this.priority = priority
    latest.set(domainId, this)
  }

  promote(): void {
    this.priority = 'reader'
  }

  start(waitMs: number): void {
    this.status = 'running'
    this.phase = 'cache-key'
    this.startedAt = new Date()
    this.phasesMs.queued = rounded(waitMs)
  }

  measureSync<T>(phase: Exclude<IntrospectionPhase, 'queued' | 'complete'>, run: () => T): T {
    this.phase = phase
    const started = performance.now()
    try {
      return run()
    } finally {
      this.add(phase, performance.now() - started)
    }
  }

  async measure<T>(
    phase: Exclude<IntrospectionPhase, 'queued' | 'complete'>,
    run: () => Promise<T>,
  ): Promise<T> {
    this.phase = phase
    const started = performance.now()
    try {
      return await run()
    } finally {
      this.add(phase, performance.now() - started)
    }
  }

  finish(result: Exclude<DomainIntrospectionTiming['result'], undefined | 'failed'>): void {
    this.status = 'complete'
    this.phase = 'complete'
    this.result = result
    this.completedAt = new Date()
    this.report()
  }

  fail(cause: unknown): void {
    this.status = 'failed'
    this.phase = 'complete'
    this.result = 'failed'
    this.error = cause instanceof Error ? cause.message : String(cause)
    this.completedAt = new Date()
    this.report()
  }

  snapshot(now = performance.now()): DomainIntrospectionTiming {
    const elapsedMs = this.completedAt
      ? this.completedAt.getTime() - this.queuedAt.getTime()
      : now - this.queuedClock
    return {
      domainId: this.domainId,
      priority: this.priority,
      status: this.status,
      phase: this.phase,
      queuedAt: this.queuedAt.toISOString(),
      ...(this.startedAt ? { startedAt: this.startedAt.toISOString() } : {}),
      ...(this.completedAt ? { completedAt: this.completedAt.toISOString() } : {}),
      elapsedMs: rounded(elapsedMs),
      phasesMs: { ...this.phasesMs },
      ...(this.result ? { result: this.result } : {}),
      ...(this.error ? { error: this.error } : {}),
    }
  }

  private add(phase: IntrospectionPhase, duration: number): void {
    this.phasesMs[phase] = rounded((this.phasesMs[phase] ?? 0) + duration)
  }

  recordCompletedPhase(phase: IntrospectionPhase, duration: number): void {
    this.add(phase, duration)
  }

  private report(): void {
    if (process.env.DOMAIN_STUDIO_TIMINGS !== '1') return
    const timing = this.snapshot()
    const phases = Object.entries(timing.phasesMs)
      .map(([phase, duration]) => `${phase}=${duration}ms`)
      .join(' ')
    console.log(
      `    timing ${timing.domainId} result=${timing.result} total=${timing.elapsedMs}ms ${phases}`,
    )
  }
}

export function introspectionTimings(): DomainIntrospectionTiming[] {
  return [...latest.values()]
    .map((timer) => timer.snapshot())
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
}

export function recordIntrospectionPhase(
  domainId: string,
  phase: IntrospectionPhase,
  durationMs: number,
): void {
  latest.get(domainId)?.recordCompletedPhase(phase, durationMs)
  if (process.env.DOMAIN_STUDIO_TIMINGS === '1') {
    console.log(`    timing ${domainId} ${phase}=${rounded(durationMs)}ms`)
  }
}
