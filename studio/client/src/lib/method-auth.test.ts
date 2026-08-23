import type { HandlerLink, IrCallableAuth, IrFunction } from '@shared/types'

import { expect, test } from 'bun:test'

import { handlerLinkFor, methodAuth } from './method-auth'

const callable = (auth: IrCallableAuth): Pick<IrFunction, 'auth'> => ({ auth })

test('renders exact canonical callable authentication', () => {
  expect(methodAuth(callable('anonymous'))).toMatchObject({
    label: 'Anonymous',
    auth: 'anonymous',
  })
  expect(methodAuth(callable('authenticated'))).toMatchObject({
    label: 'Authenticated',
    auth: 'authenticated',
  })
  expect(methodAuth(callable('authorized'))).toMatchObject({
    label: 'Authorized',
    auth: 'authorized',
  })
  expect(methodAuth()).toBeNull()
})

test('resolves runtime overlays by exact Class or Function owner kind', () => {
  const base = {
    kind: 'action',
    method: 'inspect',
    static: true,
    implemented: true,
  } as const
  const functionLink: HandlerLink = { ...base, owner: 'Shared', ownerKind: 'function' }
  const classLink: HandlerLink = { ...base, owner: 'Shared', ownerKind: 'class' }
  expect(handlerLinkFor([functionLink, classLink], 'Shared', 'inspect', 'class')).toBe(classLink)
  expect(handlerLinkFor([functionLink, classLink], 'Shared', 'inspect', 'function')).toBe(
    functionLink,
  )
})
