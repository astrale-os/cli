import { cloudflare } from '@astrale-os/adapter-cloudflare'
// Parsed statically by Studio; it is never deployed.
import { defineProject } from '@astrale-os/sdk/project'
import { dataset, tests } from '@astrale-os/sdk/testing'

import { domain } from './domain.js'
export default defineProject({
  domain,
  tests: tests({
    datasets: [dataset('./tests/datasets/support-desk.ts'), dataset('./tests/datasets/broken.ts')],
  }),
  environments: { development: { deployment: cloudflare({}) } },
})
