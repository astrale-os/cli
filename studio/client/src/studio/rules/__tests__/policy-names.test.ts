import { describe, expect, test } from 'bun:test'

import { listPolicies, policyWords } from '../policy-names'

const CLASSES = new Map(
  ['Ticket', 'Desk', 'Agent', 'SupportPlan'].map((name) => [name.toLowerCase(), name]),
)

describe('a Policy name in words', () => {
  test('is lower-cased, a Class keeping its name', () => {
    expect(policyWords('staffsDeskOfTicket', CLASSES)).toEqual(['staffs', 'Desk', 'of', 'Ticket'])
    expect(policyWords('StaffsDesk', CLASSES)).toEqual(['staffs', 'Desk'])
  })

  test('a Class of several words is one word', () => {
    expect(policyWords('holdsSupportPlanOfDesk', CLASSES)).toEqual([
      'holds',
      'SupportPlan',
      'of',
      'Desk',
    ])
  })

  test('an acronym and a separator each end a word', () => {
    expect(policyWords('isSLAOwner', CLASSES)).toEqual(['is', 'sla', 'owner'])
    expect(policyWords('staffs_desk', CLASSES)).toEqual(['staffs', 'Desk'])
  })
})

describe('Policies listed', () => {
  const listing = listPolicies(
    [
      'openedTicket',
      'staffsDesk',
      'staffsDeskOfTicket',
      'staffsDeskOfAssignedTicket',
      'staffsDeskOfSupportPlan',
      'leadsDesk',
      'leadsDeskOfTicket',
      'leadsDeskOfAgent',
      'staffsOrLeadsAnotherDesk',
    ],
    CLASSES,
  )

  test('names that open alike are a family, the largest first', () => {
    expect(listing.families.map((family) => [family.label, family.names.length])).toEqual([
      ['Staffs Desk', 4],
      ['Leads Desk', 3],
    ])
  })

  test('a family lists the Policy that is its opening first, the others by what follows', () => {
    expect(listing.families[0]!.names).toEqual([
      'staffsDesk',
      'staffsDeskOfAssignedTicket',
      'staffsDeskOfSupportPlan',
      'staffsDeskOfTicket',
    ])
    expect(listing.entries.get('staffsDesk')).toEqual({
      label: 'staffs Desk',
      phrase: 'staffs Desk',
      family: 'staffs-desk',
    })
    expect(listing.entries.get('staffsDeskOfTicket')).toEqual({
      label: '… of Ticket',
      phrase: 'staffs Desk of Ticket',
      family: 'staffs-desk',
    })
  })

  test('a Policy no family holds is listed alone, in words', () => {
    expect(listing.entries.get('openedTicket')).toEqual({
      label: 'opened Ticket',
      phrase: 'opened Ticket',
    })
    expect(listing.entries.get('staffsOrLeadsAnotherDesk')?.family).toBeUndefined()
  })

  test('the opening that saves the most words wins over a shorter one more share', () => {
    // every name opens with "can", five with "can edit Ticket": the longer opening is the family
    const picked = listPolicies(
      [
        'canEditTicket',
        'canEditTicketOfDesk',
        'canEditTicketOfAgent',
        'canEditTicketOfSupportPlan',
        'canEditTicketOfTicket',
        'canSeeDesk',
      ],
      CLASSES,
    )
    expect(picked.families.map((family) => family.label)).toEqual(['Can edit Ticket'])
    expect(picked.entries.get('canSeeDesk')?.label).toBe('can see Desk')
  })

  test('an opening never ends on a joining word, and fewer than three make no family', () => {
    const picked = listPolicies(
      ['ownerOfTicket', 'ownerOfDesk', 'ownerOfAgent', 'seesA', 'seesB'],
      CLASSES,
    )
    expect(picked.families.map((family) => family.label)).toEqual(['Owner'])
    expect(picked.entries.get('ownerOfDesk')?.label).toBe('… of Desk')
    expect(picked.entries.get('seesA')?.family).toBeUndefined()
  })
})
