/**
 * One compact credential the Kernel could have minted, for the View server suites.
 *
 * `credential.inspect` admits three non-empty base64url segments and never verifies a signature, so
 * an unsigned envelope is enough to exercise the expiration the server reads. Issuance itself
 * inspects every credential before returning it, so a mint fixture that is not readable this way
 * could not reach the server in the first place.
 */
const DEFAULT_EXPIRES_AT_SECONDS = 4_102_444_800

export function mintedCredential(
  subject: string,
  expiresAtSeconds: number = DEFAULT_EXPIRES_AT_SECONDS,
): string {
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return [
    segment({ alg: 'ES256', typ: 'JWT' }),
    segment({
      iss: 'https://kernel.test',
      aud: 'https://kernel.test',
      sub: subject,
      exp: expiresAtSeconds,
    }),
    'signature',
  ].join('.')
}
