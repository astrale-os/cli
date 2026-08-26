import type { Call } from '@astrale-os/sdk/client'
import type { ClientSession } from '@astrale-os/sdk/client/session'

import { mock } from 'bun:test'

export function adminSession(implementation?: (target: string, input: unknown) => unknown): {
  readonly call: ReturnType<typeof mock>
  readonly reflection: ReturnType<typeof mock>
  readonly session: ClientSession
} {
  const call = mock(async (request: Call) =>
    implementation?.(String(request.target), request.input),
  )
  const reflection = mock(() => {
    throw new Error('Routine Admin commands must not perform schema discovery or reflection.')
  })
  const session = {
    call,
    installation: reflection,
    snapshot: reflection,
    bind: reflection,
    invoke: reflection,
  } as unknown as ClientSession
  return { call, reflection, session }
}
