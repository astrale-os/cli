import { edgeClass, nodeClass, property } from '@astrale-os/sdk/schema'

import { icons } from '../icons.js'
import { Company, Person } from '../people/index.js'
import { string } from '../values.js'

export const Ticket = nodeClass({
  policies: { read: true },
  description: 'A customer support request.',
  icon: icons.ticket,
  properties: {
    subject: string,
    status: string,
    priority: property(string, { required: false }),
  },
})

export const Message = nodeClass({
  policies: { read: true },
  description: 'One message in a support ticket thread.',
  icon: icons.message,
  properties: { body: string, author: string },
})

export const RaisedBy = edgeClass.directed({
  policies: { read: true },
  source: { as: 'ticket', accepts: [Ticket], outgoing: '1' },
  target: { as: 'reporter', accepts: [Person], incoming: '0..*' },
})

export const AboutAccount = edgeClass.directed({
  policies: { read: true },
  source: { as: 'ticket', accepts: [Ticket], outgoing: '0..1' },
  target: { as: 'account', accepts: [Company], incoming: '0..*' },
})

export const MessageOn = edgeClass.directed({
  policies: { read: true },
  source: { as: 'message', accepts: [Message], outgoing: '1' },
  target: { as: 'ticket', accepts: [Ticket], incoming: '0..*' },
})
