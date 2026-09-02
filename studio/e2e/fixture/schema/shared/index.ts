import { method, nodeClass, property, valueSchema } from '@astrale-os/sdk/schema'

import { icons } from '../icons.js'
import { boolean, date, string } from '../values.js'

export const Document = nodeClass({
  abstract: true,
  description: 'A dated, referenced document issued by the business.',
  icon: icons.document,
  properties: {
    reference: string,
    issuedOn: property(date, { required: false }),
  },
  methods: {
    archive: method({
      description: 'Move the document out of the active set.',
      auth: 'authenticated',
      input: valueSchema<{ reason?: string }>()({
        type: 'object',
        properties: { reason: { type: 'string' } },
      }),
      output: boolean,
    }),
  },
})

export const Party = nodeClass({
  abstract: true,
  description: 'A named actor the business deals with.',
  icon: icons.party,
  properties: {
    displayName: string,
    email: property(string, { required: false }),
  },
})
