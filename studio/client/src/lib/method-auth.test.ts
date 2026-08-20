import type { HandlerLink, IrCallableAuth, IrFunction } from '@shared/types'

import { expect, test } from 'bun:test'

import { handlerLinkFor, methodAuth, unguardedCount } from './method-auth'

const link = (callableAuth: HandlerLink['callableAuth']): HandlerLink => ({
  owner: 'example.test',
  ownerKind: 'function',
  method: 'inspect',
  static: true,
  implemented: true,
  callableAuth,
})

const callable = (auth: IrCallableAuth): Pick<IrFunction, 'auth'> => ({ auth })

test('renders canonical callable auth without a wired HandlerLink', () => {
  expect(methodAuth(callable('anonymous'))).toMatchObject({
    label: 'Anonymous',
    auth: 'anonymous',
    warn: false,
  })
  expect(methodAuth(callable('authenticated'))).toMatchObject({
    label: 'Authenticated',
    auth: 'authenticated',
    warn: false,
  })
  expect(methodAuth(callable('authorized'))).toMatchObject({
    label: 'Authorized',
    auth: 'authorized',
    warn: false,
  })
  expect(
    unguardedCount([{ method: callable('authenticated') }, { method: callable('authorized') }]),
  ).toBe(0)
})

test('prefers canonical IR auth over conflicting HandlerLink fallbacks', () => {
  expect(
    methodAuth(callable('authenticated'), {
      ...link('anonymous'),
      auth: 'public',
      authorize: 'noop',
    }),
  ).toMatchObject({
    label: 'Authenticated',
    auth: 'authenticated',
    warn: false,
  })
})

test('retains HandlerLink callable and legacy auth fallbacks', () => {
  expect(methodAuth(link('anonymous'))).toMatchObject({
    label: 'Anonymous',
    auth: 'anonymous',
  })
  expect(
    methodAuth({
      ...link(undefined),
      auth: 'optional',
      authorize: 'absent',
    }),
  ).toMatchObject({
    label: 'Open',
    auth: 'optional',
    warn: true,
  })

  const persistedLegacyLink = {
    owner: 'Legacy',
    method: 'inspect',
    static: false,
    implemented: true,
    auth: 'public',
  } as unknown as HandlerLink
  expect(methodAuth(persistedLegacyLink)).toMatchObject({
    label: 'Public',
    auth: 'public',
    warn: false,
  })
  expect(
    methodAuth({ auth: 'public' } as unknown as Pick<IrFunction, 'auth'>, persistedLegacyLink),
  ).toMatchObject({ label: 'Public', auth: 'public' })
})

test('resolves handler links by exact owner kind before the legacy fallback', () => {
  const interfaceLink = {
    ...link('anonymous'),
    owner: 'Shared',
    ownerKind: 'interface' as const,
  }
  const classLink = {
    ...link('authenticated'),
    owner: 'Shared',
    ownerKind: 'class' as const,
  }
  const legacyLink = {
    ...link(undefined),
    owner: 'Legacy',
  } as unknown as HandlerLink
  delete (legacyLink as Partial<HandlerLink>).ownerKind

  expect(handlerLinkFor([interfaceLink, classLink], 'Shared', 'inspect', 'class')).toBe(classLink)
  expect(handlerLinkFor([interfaceLink, classLink], 'Shared', 'inspect', 'interface')).toBe(
    interfaceLink,
  )
  expect(handlerLinkFor([legacyLink], 'Legacy', 'inspect', 'class')).toBe(legacyLink)
  expect(handlerLinkFor([classLink], 'Shared', 'inspect', 'function')).toBeUndefined()
})
