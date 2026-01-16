import { createConfig } from '@astrale/commitlint-config'

export default createConfig({
  scopes: ['commands', 'host', 'lib', 'templates', 'deps', 'ci'],
})
