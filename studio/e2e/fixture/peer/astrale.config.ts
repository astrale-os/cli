import { cloudflare } from '@astrale-os/adapter-cloudflare'
// Parsed statically by Studio; it is never deployed.
import { defineProject } from '@astrale-os/sdk/project'

import { application } from './application.js'
export default defineProject({
  application,
  environments: { development: { deployment: cloudflare({}) } },
})
