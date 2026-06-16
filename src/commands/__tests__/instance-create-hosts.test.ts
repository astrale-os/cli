import { describe, expect, test } from 'bun:test'

import { parseEligibleHostIds } from '../instance/create'

// `instance create` recovers from alphaCreate's MULTI-host ambiguity by popping
// a picker; the recovery hinges on pulling the eligible ids out of that error.
// These pin the parse to the server's wording (Option B — no admin change).
describe('parseEligibleHostIds', () => {
  test('extracts the ids the server listed (the recoverable, >1 case)', () => {
    const e = new Error(
      'alphaCreate could not choose a host: 2 ready hosts are assigned (host-1, host-paris-02). ' +
        'Specify host_id once multi-host placement is enabled.',
    )
    expect(parseEligibleHostIds(e)).toEqual(['host-1', 'host-paris-02'])
  })

  test('returns null for the no-host error (nothing to pick — falls through to fatal)', () => {
    const e = new Error(
      'alphaCreate could not choose a host: no ready host is assigned to this user. ' +
        'Ask an admin to assign (grant USE) a host.',
    )
    expect(parseEligibleHostIds(e)).toBeNull()
  })

  test('returns null for unrelated errors and non-Error values', () => {
    expect(parseEligibleHostIds(new Error('Permission denied'))).toBeNull()
    expect(parseEligibleHostIds('something odd')).toBeNull()
  })
})
