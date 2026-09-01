import { defineSchema, nodeClass } from '@astrale-os/sdk/schema'

import { string } from './values.js'

export const PaymentProcessor = nodeClass({
  description: 'An external provider that processes customer payments.',
  properties: { name: string },
})

export const PaymentsSchema = defineSchema('payments.studio-demo.astrale.ai', {
  classes: { PaymentProcessor },
})
