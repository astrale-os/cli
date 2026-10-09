import { func, output, path, valueSchema } from '@astrale-os/sdk/schema'
import { z } from 'zod'

import { Invoice } from '../billing/index.js'
import { Ticket } from '../support/index.js'
import { boolean, string } from '../values.js'

/** A domain callable with no receiver, working on one Invoice. */
export const reconcileInvoice = func({
  description: 'Reconcile one invoice against the payments recorded for it.',
  auth: 'authenticated',
  input: z.object({ invoice: path(Invoice) }),
  output: boolean,
})

/** A second bound Function, so the overview groups by more than one Class. */
export const escalateTicket = func({
  description: 'Raise one support ticket to the on-call team.',
  auth: 'authenticated',
  input: z.object({ ticket: path(Ticket), reason: z.string() }),
  output: boolean,
})

/** A Function that names no Class at all — the standalone case. */
export const exportLedger = func({
  description: 'Stream the ledger for an accounting period.',
  auth: 'anonymous',
  input: valueSchema<{ period: string }>()({
    type: 'object',
    properties: { period: { type: 'string' } },
    required: ['period'],
  }),
  output: output.stream(string),
})
