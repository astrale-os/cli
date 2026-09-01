import { core, edgeClass, nodeClass, property } from '@astrale-os/sdk/schema'

import { icons } from '../icons.js'
import { Party } from '../shared/index.js'
import { boolean, string } from '../values.js'

export const Person = nodeClass({
  description: 'A human being known to the company.',
  icon: icons.party,
  extends: [Party],
  properties: {
    fullName: string,
    phone: property(string, { required: false }),
  },
})

export const Company = nodeClass({
  description: 'An organisation we do business with.',
  icon: icons.company,
  extends: [Party],
  properties: {
    legalName: string,
    country: string,
    active: property(boolean, { required: false }),
  },
})

export const Team = nodeClass({
  description: 'An internal team owning a set of accounts.',
  icon: icons.team,
  properties: { name: string, region: string },
})

export const WorksAt = edgeClass.directed({
  description: 'Employment relationship.',
  properties: { title: property(string, { required: false }) },
  source: { as: 'employee', accepts: [Person], outgoing: '0..*' },
  target: { as: 'employer', accepts: [Company], incoming: '0..*' },
})

export const BelongsToTeam = edgeClass.directed({
  description: 'Internal team membership.',
  source: { as: 'member', accepts: [Person], outgoing: '0..1' },
  target: { as: 'team', accepts: [Team], incoming: '0..*' },
})

export const platformTeam = core.node(Team, { name: 'Platform', region: 'EU' })
