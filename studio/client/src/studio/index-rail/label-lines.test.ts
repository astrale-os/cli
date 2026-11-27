import { describe, expect, test } from 'bun:test'

import { labelLines, linesApart, nameParts, wholeLines } from './label-lines'

/** One unit per character. */
const chars = (text: string) => text.length

describe('an Index name in its lines', () => {
  test('breaks between the words of a name', () => {
    expect(nameParts('ownsOrBelongsToProject')).toEqual(['owns', 'Or', 'Belongs', 'To', 'Project'])
    expect(nameParts('policy.mayRead_ticket')).toEqual(['policy.', 'may', 'Read_', 'ticket'])
    expect(nameParts('Admin → Issues')).toEqual(['Admin ', '→ ', 'Issues'])
  })

  test('reads whole on one line where it fits, else on up to three, then ends with "…"', () => {
    expect(labelLines('mayReadTicket', 20, chars)).toEqual(['mayReadTicket'])
    expect(labelLines('ownsOrBelongsToProject', 13, chars)).toEqual(['ownsOrBelongs', 'ToProject'])
    expect(labelLines('mayManageEveryInvoiceOfTheFleet', 12, chars)).toEqual([
      'mayManage',
      'EveryInvoice',
      'OfTheFleet',
    ])
    const long = labelLines('mayManageEveryInvoiceOfTheFleetAndItsHosts', 12, chars)
    expect(long).toEqual(['mayManage', 'EveryInvoice', 'OfTheFleet…'])
    // Never cut in its middle: only the last line may end early.
    for (const line of long.slice(0, -1)) expect(line).not.toContain('…')
    for (const line of long) expect(line.length).toBeLessThanOrEqual(12)
  })

  test('whole, it takes as many lines as it needs', () => {
    expect(wholeLines('mayManageEveryInvoiceOfTheFleet', 12, chars)).toEqual([
      'mayManage',
      'EveryInvoice',
      'OfTheFleet',
    ])
  })

  test('two names that would read alike each read whole', () => {
    const entries = [
      { name: 'mayManageEveryInvoiceOfTheFleetAndItsHosts', room: 12 },
      { name: 'mayManageEveryInvoiceOfTheFleetAndItsRacks', room: 12 },
      { name: 'mayReadTicket', room: 20 },
    ]
    const lines = linesApart(entries, chars)
    expect(lines[0]).toEqual(['mayManage', 'EveryInvoice', 'OfTheFleet', 'AndItsHosts'])
    expect(lines[1]).toEqual(['mayManage', 'EveryInvoice', 'OfTheFleet', 'AndItsRacks'])
    expect(lines[2]).toEqual(['mayReadTicket'])
    expect(new Set(lines.map((each) => each.join('\n'))).size).toBe(entries.length)
  })
})
