import type { StudioEvent } from '../../shared/contracts/runtime'
import type { Notify } from '../api/http'

/** Keep optional UI delivery failures from corrupting committed agent state. */
export function emitStudioEvent(notify: Notify, event: StudioEvent): void {
  try {
    notify(event)
  } catch {
    /* the persisted state remains authoritative; clients can refetch */
  }
}
