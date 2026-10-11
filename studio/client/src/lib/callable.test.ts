import type { HandlerLink } from '@shared/contracts/schema'

import { expect, test } from 'bun:test'

import { handlerLinkFor } from './callable'

test('a handler link resolves by exact owner kind: a Function and a Class may share a name', () => {
  const base = { kind: 'action', method: 'inspect', static: true, implemented: true } as const
  const functionLink: HandlerLink = { ...base, owner: 'Shared', ownerKind: 'function' }
  const classLink: HandlerLink = { ...base, owner: 'Shared', ownerKind: 'class' }
  const links = [functionLink, classLink]
  expect(handlerLinkFor(links, 'Shared', 'inspect', 'class')).toBe(classLink)
  expect(handlerLinkFor(links, 'Shared', 'inspect', 'function')).toBe(functionLink)
})
