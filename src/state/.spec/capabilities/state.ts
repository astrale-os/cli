import { defineCapability } from '@astrale-os/spec/authoring'

export const CLI_STATE = defineCapability({
  id: 'CLI-STATE',
  statement:
    'Owns captured CLI filesystem coordinates and bounded atomic transitions for local durable state.',
})
