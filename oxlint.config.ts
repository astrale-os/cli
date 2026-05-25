import base from '@astrale-os/ox/lint'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base],
  rules: {
    'no-console': 'off',
  },
  overrides: [
    {
      // Tunnel commands MUST stay adapter-agnostic: go through
      // `resolveTunnelAdapter()` from `adapters/tunnel`, never import the
      // cloudflared concrete (adapter, binary wrapper, or config renderer).
      files: ['src/commands/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '**/adapters/tunnel-cloudflared',
                  '**/lib/cloudflared',
                  '**/lib/cloudflared-config',
                ],
                message:
                  'Commands must stay tunnel-adapter-agnostic: use resolveTunnelAdapter() from adapters/tunnel instead of importing the cloudflared concrete.',
              },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: ['templates/**/*'],
})
