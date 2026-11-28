import type { NodeId } from '@astrale-os/sdk/graph/node'

import { defineQuery } from '@astrale-os/sdk/query'

import type { StudioE2ESchema } from '../schema/index.js'

export interface TicketsAboutAccountInput {
  /** The Company the tickets are about. */
  readonly account: NodeId
  /** Only the tickets in this status; every status when absent. */
  readonly status?: string
}

/** The tickets about one account, each with that account and the person who raised it. */
export const ticketsAboutAccount = defineQuery<StudioE2ESchema>()('crm.ticket.about-account', {
  build: (input: TicketsAboutAccountInput, { Ticket }) =>
    Ticket.where((ticket) => [
      ticket.account.is(input.account),
      input.status !== undefined && ticket.status.eq(input.status),
    ])
      .with((ticket) => ({ account: ticket.account.find(), reporter: ticket.reporter.get() }))
      .all({ max: 200 }),
})

/** One ticket as its page shows it: who raised it, the account it is about, and its messages. */
export const ticketPage = defineQuery<StudioE2ESchema>()('crm.ticket.page', {
  build: (ticket: NodeId, { Ticket, MessageOn }) =>
    Ticket.with((one) => ({
      reporter: one.reporter.get(),
      account: one.account.find(),
      messages: one.via(MessageOn, { direction: 'incoming' }).all({ max: 100 }),
    })).find(ticket),
})
