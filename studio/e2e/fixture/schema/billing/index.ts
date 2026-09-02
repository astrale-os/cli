import {
  edgeClass,
  method,
  nodeClass,
  output,
  policy,
  property,
  valueSchema,
} from '@astrale-os/sdk/schema'

import { PaymentProcessor } from '../external.js'
import { icons } from '../icons.js'
import { Company } from '../people/index.js'
import { Quote } from '../sales/index.js'
import { Document } from '../shared/index.js'
import { boolean, number, string } from '../values.js'

export const mayManageInvoice = policy({
  description: 'The caller is the account this invoice is billed to.',
  match: ({ edge, subject, object }) =>
    edge({ source: object, class: () => BilledTo, target: subject }),
})

export const Invoice = nodeClass({
  description: 'A demand for payment issued to a customer.',
  icon: icons.invoice,
  extends: [Document],
  properties: { total: number, paid: property(boolean, { required: false }) },
  methods: {
    settle: method({
      description: 'Record a payment against this invoice.',
      auth: 'authorized',
      input: valueSchema<{ amount: number; note?: string }>()({
        type: 'object',
        properties: { amount: { type: 'number' }, note: { type: 'string' } },
        required: ['amount'],
      }),
      output: boolean,
      policy: ({ check, self }) => check(mayManageInvoice, self),
    }),
    remind: method({
      description: 'Send the customer a reminder.',
      auth: 'authorized',
      input: valueSchema<{ channel: 'email' | 'sms' }>()({
        type: 'object',
        properties: { channel: { type: 'string', enum: ['email', 'sms'] } },
        required: ['channel'],
      }),
      output: valueSchema<{ sentAt: string; channel: string }>()({
        type: 'object',
        properties: { sentAt: { type: 'string' }, channel: { type: 'string' } },
        required: ['sentAt', 'channel'],
      }),
    }),
    search: method({
      description: 'Find invoices by reference.',
      static: true,
      auth: 'anonymous',
      input: valueSchema<{ query: string; limit?: number }>()({
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query'],
      }),
      output: output.stream(
        valueSchema<{ reference: string; total: number }>()({
          type: 'object',
          properties: { reference: { type: 'string' }, total: { type: 'number' } },
          required: ['reference', 'total'],
        }),
      ),
    }),
  },
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
