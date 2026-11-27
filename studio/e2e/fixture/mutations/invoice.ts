import { defineMutation } from '@astrale-os/sdk/mutation'

/** Record a Payment against an Invoice and mark the Invoice paid. */
export const settleInvoice = defineMutation()('crm.invoice.settle', {
  build: (input, { Invoice, Payment, SettledBy }, mutation) => {
    mutation.updateNode({ node: input.invoice, class: Invoice, props: { paid: true } })
    const payment = mutation.createNode({
      as: 'payment',
      class: Payment,
      props: { amount: input.amount, method: 'transfer' },
    })
    mutation.createEdge({ class: SettledBy, source: input.invoice, target: payment })
  },
})

/** Mark an Invoice paid once its Payments cover its total. */
export const reconcileInvoice = defineMutation()('crm.invoice.reconcile', {
  build: (input, { Invoice }, mutation) => {
    mutation.updateNode({ node: input.invoice, class: Invoice, props: { paid: input.paid } })
  },
})
