import { createConfig } from '@astrale/eslint-config'

export default createConfig({
  tsconfigRootDir: import.meta.dirname,
  ignorePatterns: ['src/templates/**/*'],
  rules: {
    'no-console': 'off',
  },
})
