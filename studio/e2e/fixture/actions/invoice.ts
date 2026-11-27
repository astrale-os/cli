import { defineAction } from '@astrale-os/sdk/action'

import { reconcileInvoice, settleInvoice } from '../mutations/invoice.js'

/** Settle: record the Payment in the ledger, then in the graph. */
export const settle = defineAction()('Invoice.settle', async (context) => {
  await context.integrations.ledger.record({ invoice: context.self, amount: context.input.amount })
  return context.mutate(settleInvoice, { invoice: context.self, amount: context.input.amount })
})

/** Reconcile: the Invoice is paid when its Payments cover its total. */
export const reconcile = defineAction()('reconcileInvoice', async (context) =>
  context.mutate(reconcileInvoice, { invoice: context.input.invoice, paid: true }),
)
