import { edgeClass, nodeClass, property } from '@astrale-os/sdk/schema'

import { PaymentProcessor } from '../external.js'
import { icons } from '../icons.js'
import { Company } from '../people/index.js'
import { Quote } from '../sales/index.js'
import { Document } from '../shared/index.js'
import { boolean, number, string } from '../values.js'

export const Invoice = nodeClass({
  description: 'A demand for payment issued to a customer.',
  icon: icons.invoice,
  extends: [Document],
  properties: { total: number, paid: property(boolean, { required: false }) },
})

export const Payment = nodeClass({
  description: 'Money received against an invoice.',
  icon: icons.payment,
  properties: { amount: number, method: string },
})

export const Subscription = nodeClass({
  description: 'A recurring customer commitment.',
  icon: icons.subscription,
  properties: { plan: string, monthly: number },
})

export const BilledTo = edgeClass.directed({
  source: { as: 'invoice', accepts: [Invoice], outgoing: '1' },
  target: { as: 'customer', accepts: [Company], incoming: '0..*' },
})

export const IssuedFrom = edgeClass.directed({
  source: { as: 'invoice', accepts: [Invoice], outgoing: '0..1' },
  target: { as: 'quote', accepts: [Quote], incoming: '0..1' },
})

export const SettledBy = edgeClass.directed({
  source: { as: 'invoice', accepts: [Invoice], outgoing: '0..*' },
  target: { as: 'payment', accepts: [Payment], incoming: '1' },
})

export const SubscribedTo = edgeClass.directed({
  source: { as: 'customer', accepts: [Company], outgoing: '0..*' },
  target: { as: 'subscription', accepts: [Subscription], incoming: '0..*' },
})

export const ProcessedBy = edgeClass.directed({
  source: { as: 'payment', accepts: [Payment], outgoing: '0..1' },
  target: { as: 'processor', accepts: [PaymentProcessor], incoming: '0..*' },
})
