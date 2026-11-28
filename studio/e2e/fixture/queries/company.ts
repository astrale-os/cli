import { defineQuery } from '@astrale-os/sdk/query'

import type { StudioE2ESchema } from '../schema/index.js'

/** Every account the business deals with, by legal name. */
export const companies = defineQuery<StudioE2ESchema>()('crm.company.all', {
  build: (_: undefined, { Company }) =>
    Company.orderBy((company) => company.legalName.asc()).all({ max: 500 }),
})
