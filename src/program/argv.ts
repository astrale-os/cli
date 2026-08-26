/**
 * Keep `astrale --version` as the familiar root spelling without claiming the
 * same flag after a subcommand. Commands such as `ui list` and `update` own
 * their release `--version` value.
 */
export function normalizeRootVersionArgv(argv: readonly string[]): string[] {
  const normalized = [...argv]
  const commandIndex = normalized.findIndex((token, index) => index >= 2 && !token.startsWith('-'))
  const versionIndex = normalized.indexOf('--version', 2)
  if (versionIndex !== -1 && (commandIndex === -1 || versionIndex < commandIndex)) {
    normalized[versionIndex] = '--cli-version'
  }
  return normalized
}
