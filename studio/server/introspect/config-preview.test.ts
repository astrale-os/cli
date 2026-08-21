import { expect, test } from 'bun:test'

import { parseConfigPreview } from './config-preview'

test('config preview ignores examples in comments and preserves URL literals', () => {
  const preview = parseConfigPreview(`
// cloudflare({ prod: { route: 'commented.invalid', secrets: '.env.fake' } })
/* astrale({ prod: { instance: 'commented-instance' } }) */
export default deploy(domain, cloudflare({
  dev: { client: { dir: 'client' }, secrets: '.env.dev' },
  prod: {
    client: { dir: 'client' },
    route: 'https://services.example.dev/path',
    secrets: '.env.prod',
  },
}))
`)

  expect(preview).toEqual({
    adapter: 'cloudflare',
    prodTarget: 'route: https://services.example.dev/path',
    devSecrets: '.env.dev',
    configuredSecretFiles: ['.env.dev', '.env.prod'],
  })
})

test('config preview reports dynamic configuration as unknown instead of inventing authority', () => {
  expect(parseConfigPreview(`export default makeDeployment(domain)`)).toEqual({
    adapter: 'unknown',
    configuredSecretFiles: [],
  })
})
