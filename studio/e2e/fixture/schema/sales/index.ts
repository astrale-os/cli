import { edgeClass, nodeClass } from '@astrale-os/sdk/schema'

import { icons } from '../icons.js'
import { Company, Person } from '../people/index.js'
import { Document } from '../shared/index.js'
import { number, string } from '../values.js'

export const Opportunity = nodeClass({
  description: 'A potential deal in the sales pipeline.',
  icon: icons.opportunity,
  properties: { name: string, stage: string, amount: number },
})

export const Quote = nodeClass({
  description: 'A priced proposal sent to a customer.',
  icon: icons.document,
  extends: [Document],
  properties: { total: number },
})

export const Product = nodeClass({
  description: 'Something the business sells.',
  icon: icons.product,
  properties: { sku: string, label: string, unitPrice: number },
})

export const OpportunityFor = edgeClass.directed({
  description: 'Links an opportunity to its customer account.',
  source: { as: 'opportunity', accepts: [Opportunity], outgoing: '1' },
  target: { as: 'account', accepts: [Company], incoming: '0..*' },
})

export const OwnedBy = edgeClass.directed({
  description: 'Assigns sales ownership.',
  source: { as: 'opportunity', accepts: [Opportunity], outgoing: '1' },
  target: { as: 'owner', accepts: [Person], incoming: '0..*' },
})

export const QuoteOf = edgeClass.directed({
  source: { as: 'quote', accepts: [Quote], outgoing: '1' },
  target: { as: 'opportunity', accepts: [Opportunity], incoming: '0..*' },
})

export const QuoteLine = edgeClass.directed({
  description: 'A product and quantity included in a quote.',
  properties: { quantity: number },
  source: { as: 'quote', accepts: [Quote], outgoing: '0..*' },
  target: { as: 'product', accepts: [Product], incoming: '0..*' },
})
