export function invalidConfiguration(expectation) {
  throw new TypeError(`Exact source configuration requires ${expectation}.`)
}
