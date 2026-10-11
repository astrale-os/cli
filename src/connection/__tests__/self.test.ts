import { describe, expect, test } from 'bun:test'

import type { ConnectionContext } from '../session'

import { expandSelfInCall, expandSelfInPath } from '../self'

function caller(id: string) {
  let resolutions = 0
  const context = {
    auth: { whoami: async () => ({ id: 'shell-domain-id' }) },
    self: async () => {
      resolutions += 1
      return { id }
    },
    target: { slug: 'child' },
  } as unknown as ConnectionContext
  return { context, resolutions: () => resolutions }
}

describe('@self expansion', () => {
  /** @evidence TEST-CLI-SELF-USES-AUTHENTICATED-EFFECTIVE-PRINCIPAL */
  test('expands the selected caller once across receiver and top-level string parameters', async () => {
    const { context, resolutions } = caller('caller-id')
    const expanded = await expandSelfInCall(
      '@self::resolveHome',
      { owner: '@self', count: 2, nested: { owner: '@self' } },
      context,
    )
    expect(expanded).toEqual({
      path: '@caller-id::resolveHome',
      parameters: { owner: '@caller-id', count: 2, nested: { owner: '@self' } },
      meta: {
        original: '@self::resolveHome',
        expanded: '@caller-id::resolveHome',
        selfId: 'caller-id',
        slug: 'child',
      },
    })
    expect(resolutions()).toBe(1)

    await expandSelfInCall('@explicit-user::resolveHome', {}, context)
    expect(resolutions()).toBe(1)
  })

  test('fails closed when authenticated whoami returns no NodeId', async () => {
    await expect(expandSelfInPath('@self', caller('   ').context)).rejects.toMatchObject({
      code: 'SELF_RESOLUTION_FAILED',
    })
  })
})
