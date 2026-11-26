import { ClassKey } from '@astrale-os/sdk/graph/class'
import { Path } from '@astrale-os/sdk/graph/path'
import { Query } from '@astrale-os/sdk/query'

/**
 * The Paths and Queries Domain Studio uses to read and act on an installed Domain's Schedules
 * (ADR-10) through this CLI: `astrale query --ast` over the Domain's members and their
 * `schedule_of` Edges, `astrale call` of a Schedule's Kernel Methods, and run now as an ordinary
 * call of the callable a Schedule starts.
 */

const KERNEL = 'kernel.astrale.ai'

const kernelEdge = (name: string) =>
  ClassKey.ref(ClassKey.of({ origin: KERNEL, kind: 'class', name }))

/** Each Schedule whose Function is a member of `origin`, with its Function's id and its input. */
export function schedulesQuery(origin: string): unknown {
  const members = Query.from({ nodes: [Path.domain(origin as never)] }).expand({
    via: [kernelEdge('of_domain')],
    direction: 'incoming',
  })
  const schedules = members.expand({ via: [kernelEdge('schedule_of')], direction: 'incoming' })
  return schedules.select({
    kind: 'edges',
    binding: schedules.edge,
    projection: { edge: 'reference', source: 'value', target: 'reference' },
  })
}

/** The of_domain Edge of each of these Functions, whose `member` names it in its Domain. */
export function membersQuery(functions: readonly string[]): unknown {
  const owners = Query.from({
    nodes: functions.map((id) => Path.parse(`@${id}`)) as [Path, ...Path[]],
  }).expand({ via: [kernelEdge('of_domain')], direction: 'outgoing' })
  return owners.select({
    kind: 'edges',
    binding: owners.edge,
    projection: { edge: 'value', source: 'reference', target: 'reference' },
  })
}

/** The Kernel Method of one Schedule: `status`, `pause` or `resume`. */
export function scheduleMethodPath(
  schedule: string,
  method: 'status' | 'pause' | 'resume',
): string {
  return `@${schedule}::${KERNEL}:class.Schedule.method.${method}`
}

/**
 * The callable a member names and the Path that calls it: a Function, or a static Method (a
 * Schedule never starts an instance Method, which has a receiver).
 */
export function memberCallable(
  origin: string,
  member: string,
): { readonly callable: string; readonly call: string } | undefined {
  const fn = /^function\.([A-Za-z_$][\w$]*)$/u.exec(member)
  if (fn) {
    const call = Path.project({ origin, kind: 'function', name: fn[1]! } as never).raw
    return { callable: fn[1]!, call }
  }
  const method = /^class\.([A-Za-z_$][\w$]*)\.method\.([A-Za-z_$][\w$]*)$/u.exec(member)
  if (!method) return undefined
  const owner = Path.project({ origin, kind: 'class', name: method[1]! } as never)
  return {
    callable: `${method[1]}.${method[2]}`,
    call: Path.staticMethod(owner, method[2]!).raw,
  }
}

/** A run-now target must be a Function or a static Method of a Domain: never another Path. */
export function admitRunTarget(call: unknown): string | undefined {
  if (typeof call !== 'string') return undefined
  try {
    const path = Path.parse(call)
    const last = path.ast.steps.at(-1)
    const callable =
      path.ast.anchor.kind === 'domain' &&
      ((last?.kind === 'projection' && last.projection.kind === 'function') ||
        (last?.kind === 'method' && last.dispatch === 'static'))
    return callable ? call : undefined
  } catch {
    return undefined
  }
}
