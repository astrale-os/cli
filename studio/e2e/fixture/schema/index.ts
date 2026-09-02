import { defineSchema, view } from '@astrale-os/sdk/schema'

import {
  BilledTo,
  Invoice,
  IssuedFrom,
  mayManageInvoice,
  Payment,
  ProcessedBy,
  SettledBy,
  SubscribedTo,
  Subscription,
} from './billing/index.js'
import { PaymentsSchema } from './external.js'
import { BelongsToTeam, Company, Person, platformTeam, Team, WorksAt } from './people/index.js'
import {
  Opportunity,
  OpportunityFor,
  OwnedBy,
  Product,
  Quote,
  QuoteLine,
  QuoteOf,
} from './sales/index.js'
import { Document, Party } from './shared/index.js'
import { AboutAccount, Message, MessageOn, RaisedBy, Ticket } from './support/index.js'

export const StudioE2ESchema = defineSchema('crm.studio-demo.astrale.ai', {
  dependencies: { payments: PaymentsSchema },
  classes: {
    Party,
    Document,
    Person,
    Company,
    Team,
    WorksAt,
    BelongsToTeam,
    Opportunity,
    Quote,
    Product,
    OpportunityFor,
    OwnedBy,
    QuoteOf,
    QuoteLine,
    Invoice,
    Payment,
    Subscription,
    BilledTo,
    IssuedFrom,
    SettledBy,
    SubscribedTo,
    ProcessedBy,
    Ticket,
    Message,
    RaisedBy,
    AboutAccount,
    MessageOn,
  },
  views: {
    overview: view({
      description: 'CRM overview.',
      target: 'domain',
    }),
  },
  policies: { mayManageInvoice },
  core: { nodes: { platform: platformTeam }, edges: [] },
})

export type StudioE2ESchema = typeof StudioE2ESchema
