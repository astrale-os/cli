import type { Call, Input } from '@astrale-os/sdk/client'

import { ClientSession } from '@astrale-os/sdk/client/session'
import { mock } from 'bun:test'

export function adminSession(implementation?: (target: string, input: unknown) => unknown): {
  readonly call: ReturnType<typeof mock>
  readonly reflection: ReturnType<typeof mock>
  readonly session: ClientSession
} {
  const call = mock<ClientSession['call']>(
    async (request: Call) => implementation?.(String(request.target), request.input) as Input,
  )
  const reflection = mock(() => {
    throw new Error('Routine Admin commands must not perform schema discovery or reflection.')
  })
  const session = Object.assign(
    new ClientSession({
      kernel: 'https://admin.test',
      policy: { maximumRouteAgeMs: 60_000 },
    }),
    {
      call,
      installation: reflection,
      snapshot: reflection,
      bind: reflection,
      invoke: reflection,
    },
  )
  return { call, reflection, session }
}
