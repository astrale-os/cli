/**
 * Which create-astrale-domain the CLI scaffolds new Domains with: Studio's "new Domain" and
 * `astrale setup` both resolve this one range, and neither passes `--instance`.
 *
 * A scaffold names no instance. Which instance runs a deployment is the operator's choice, made
 * when installing the URL a deploy prints (`astrale domain install <url> -i <instance>`).
 *
 * The floor is the first create-astrale-domain release that carries sdk#598 (S8): releases
 * before it require `--instance` in non-interactive managed mode, so a CLI that never passes the
 * flag must never resolve below it. That release is not cut yet (0.3.0-beta.159 still requires
 * the flag); until it is, the floor is a placeholder, and C10 merges only once it names that
 * release's exact version.
 *
 * NOT `@latest`: `latest` is the scaffolder's last STABLE release (0.2.x), a generation behind,
 * which writes a Domain against `@astrale-os/sdk` 0.4.x that nothing in Studio can read.
 *
 * A RANGE rather than the `beta` dist-tag, because a tag resolves to exactly one version and npm
 * environments commonly quarantine very recent releases (a few days old); asking for `@beta` then
 * fails outright, while a range takes the newest matching version actually being served. Under
 * npm semver a prerelease satisfies the range only on the floor's own `0.3.0` tuple: a scaffolder
 * moved to another line (`0.3.1-beta.x`, `0.4.0-beta.x`) never matches, so moving it means
 * bumping this range in the same CLI release.
 */
export const SCAFFOLDER_RANGE = '>=0.3.0-beta.160'

/** The npx package spec for {@link SCAFFOLDER_RANGE}. Quote it in a shell (`>=`). */
export const SCAFFOLDER = `create-astrale-domain@${SCAFFOLDER_RANGE}`
