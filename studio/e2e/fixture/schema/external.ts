import { defineSchema, nodeClass } from '@astrale-os/sdk/schema'

import { icons } from './icons.js'
import { string } from './values.js'

export const PaymentProcessor = nodeClass({
  policies: { read: true },
  description: 'An external provider that processes customer payments.',
  icon: icons.payment,
  properties: { name: string },
})

/** A second Class of the same Domain, so its Classes are drawn together in its frame. */
export const Payout = nodeClass({
  policies: { read: true },
  description: 'A transfer of settled funds to the merchant.',
  icon: icons.payment,
  properties: { reference: string },
})

export const PaymentsSchema = defineSchema('payments.studio-demo.astrale.ai', {
  name: 'Test Domain',
  classes: { PaymentProcessor, Payout },
})
