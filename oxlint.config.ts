import base from '@astrale-os/ox/lint'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base],
  rules: {
    'no-console': 'off',
  },
  // `studio/` is the moved-in Domain Studio sub-app (React/Bun/Vite) with its
  // own toolchain — it is not linted as part of the CLI. It keeps its own
  // typecheck (tsgo); adopt oxlint there separately if desired.
  ignorePatterns: ['templates/**/*', 'studio/**/*'],
})
