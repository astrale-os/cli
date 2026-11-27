import { edgeClass, nodeClass, policy, property } from '@astrale-os/sdk/schema'

import { icons } from '../icons.js'
import { Company, Person } from '../people/index.js'
import { string } from '../values.js'

/** Only whoever raised a ticket reads it. */
export const mayReadTicket = policy({
  description: 'The caller raised this ticket.',
  match: ({ edge, subject, object }) =>
    edge({ source: object, class: () => RaisedBy, target: subject }),
})

export const Ticket = nodeClass({
  policies: { read: () => mayReadTicket, traverse: () => mayReadTicket },
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

/** One end that accepts two Classes: a message may mention a person or a company. */
export const Mentions = edgeClass.directed({
  policies: { read: true },
  description: 'A party a message mentions.',
  source: { as: 'message', accepts: [Message], outgoing: '0..*' },
  target: { as: 'mentioned', accepts: [Person, Company], incoming: '0..*' },
})
