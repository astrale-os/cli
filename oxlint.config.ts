import base from '@astrale-os/ox/lint'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base],
  rules: {
    'no-console': 'off',
  },
  ignorePatterns: ['templates/**/*'],
})
