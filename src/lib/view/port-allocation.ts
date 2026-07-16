import { join } from 'node:path'

import { withFileLock } from '../fs-atomic'
import { VIEW_DIR } from './session'

const VIEW_PORT_LOCK = join(VIEW_DIR, 'ports.lock')

/**
 * Keep the free-port probe and detached server startup in one cross-process
 * critical section. A probe alone is only advisory: without this lock, two
 * concurrent `astrale view` processes can both observe 4419 as free before
 * either child binds it.
 */
export function withViewPortAllocationLock<T>(
  fn: () => Promise<T>,
  lockPath = VIEW_PORT_LOCK,
): Promise<T> {
  return withFileLock(lockPath, fn)
}
