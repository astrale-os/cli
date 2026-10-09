import { cloudflare } from '@astrale-os/adapter-cloudflare'
// Parsed statically by Studio; it is never deployed.
import { defineProject } from '@astrale-os/sdk/project'

import { domain } from './domain.js'
export default defineProject({
  domain,
  environments: { development: { deployment: cloudflare({}) } },
})
