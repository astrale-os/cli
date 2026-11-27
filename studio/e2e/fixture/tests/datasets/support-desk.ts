import { defineDataset } from '@astrale-os/sdk/testing'

import { StudioE2ESchema } from '../../schema/index.js'

/**
 * Two people at one customer, each with the ticket they raised, and an invoice billed to the
 * customer: read as Ann, Bob's ticket is the one Node the Ticket read Policy refuses.
 */
export default defineDataset(StudioE2ESchema, {
  id: 'support-desk',
  title: 'Support desk',
  description: 'Two people at Acme, the ticket each raised, and an invoice billed to Acme.',
  graph({ classes, node, edge }) {
    const acme = node(classes.Company, {
      id: 'acme',
      props: { displayName: 'Acme', legalName: 'Acme SAS', country: 'FR' },
    })
    const ann = node(classes.Person, {
      id: 'ann',
      props: { displayName: 'Ann', fullName: 'Ann Lee' },
    })
    const bob = node(classes.Person, {
      id: 'bob',
      props: { displayName: 'Bob', fullName: 'Bob Stone' },
    })
    const printer = node(classes.Ticket, {
      id: 'printer',
      props: { subject: 'Printer jams', status: 'open' },
    })
    const login = node(classes.Ticket, {
      id: 'login',
      props: { subject: 'Cannot log in', status: 'open' },
    })
    const invoice = node(classes.Invoice, {
      id: 'invoice-1',
      props: { reference: 'INV-1', total: 120 },
    })
    edge(classes.WorksAt, ann, acme)
    edge(classes.WorksAt, bob, acme)
    edge(classes.RaisedBy, printer, ann)
    edge(classes.RaisedBy, login, bob)
    edge(classes.AboutAccount, printer, acme)
    edge(classes.BilledTo, invoice, acme)
  },
})
