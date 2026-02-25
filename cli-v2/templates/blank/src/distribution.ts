import { defineDistribution } from '@astrale-os/kernel-toolkit/distribution'
import { schema, validators } from '../schema/schema.generated'

export default defineDistribution({
  name: '{{APP_SLUG}}',
  version: '0.1.0',
  schema,
  validators,
  methods: [],
})
