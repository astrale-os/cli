import { edgeClass, nodeClass, property } from '@astrale-os/sdk/schema'

import { icons } from '../icons.js'
import { Company, Person } from '../people/index.js'
import { string } from '../values.js'

export const Ticket = nodeClass({
  description: 'A customer support request.',
  icon: icons.ticket,
  properties: {
    subject: string,
    status: string,
    priority: property(string, { required: false }),
  },
})

export const Message = nodeClass({
  description: 'One message in a support ticket thread.',
  icon: icons.message,
  properties: { body: string, author: string },
})

export const RaisedBy = edgeClass.directed({
  source: { as: 'ticket', accepts: [Ticket], outgoing: '1' },
  target: { as: 'reporter', accepts: [Person], incoming: '0..*' },
})

export const AboutAccount = edgeClass.directed({
  source: { as: 'ticket', accepts: [Ticket], outgoing: '0..1' },
  target: { as: 'account', accepts: [Company], incoming: '0..*' },
})

export const MessageOn = edgeClass.directed({
  source: { as: 'message', accepts: [Message], outgoing: '1' },
  target: { as: 'ticket', accepts: [Ticket], incoming: '0..*' },
})
