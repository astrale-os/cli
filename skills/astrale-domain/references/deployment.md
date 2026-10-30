# Deploy, install, and publish

`astrale-domain` (SDK binary, run in the Domain project) deploys and publishes; the `astrale` CLI
installs. Only an install changes what an Instance runs.

| Command | Creates a deployment | Names a version | Changes an Instance |
| --- | --- | --- | --- |
| `astrale-domain deploy <environment>` | yes | no | no |
| `astrale-domain publish <environment>` | yes (deploy included) | yes, the `package.json` version | no |
| `astrale domain install <reference>... -i <instance>` | no | no | yes |

`astrale-domain build`, `diff`, `list` and `astrale domain versions` only read.

## Deploy, then install

```sh
pnpm run deploy development                 # astrale-domain deploy development: prints the deployment URL
astrale domain install <url> -i acme-dev    # pin that release on the instance
```

- A deploy makes one immutable deployment of one release (build + the Environment's frozen
  configuration) at `https://<line>-<content>.<routing domain>`, with its own generated signing key.
  `line` = f(origin, Environment); `content` = f(build, configuration). The same release reuses its
  deployment; other code, another variable or another set of secret names gives another URL.
  Earlier deployments keep serving.
- A deployment without a version is a preview, installable by URL only. Hosts keep every deployment
  until its owner retires it: no expiry, no retention.
- The URL is a pin: the CLI reads the release it serves and pins its release digest; the Kernel
  refuses any other (`SCHEMA_REVISION_CONFLICT`) and installs only a DomainRelease v4. New code
  reaches an Instance only through an install of its new URL or version.
- Domains that move together go in ONE grouped install, atomic, mixing URLs and versions; never
  chain one-Domain installs for a coherent set:

```sh
URL_A=$(pnpm --dir projects exec astrale-domain deploy staging --json | jq -r .url)
URL_B=$(pnpm --dir teams exec astrale-domain deploy staging --json | jq -r .url)
astrale domain install "$URL_A" "$URL_B" --allow-issuer-change -i acme-stg
```

- `deploy --json`: one DeployResultV1 on stdout (`url` is what install takes); progress on stderr.
- `astrale-domain list`: the deployments of the Project's Environments, each named by the
  registry's version of its release (`1.5.0`) or build (`1.5.0 · staging`), else by a name computed
  from its commit (`1.4.2 + 7 commits · a1b2c3d · staging`), and `current` for the one its Service
  serves. `--instance <name>` (repeatable) fills INSTALLED ON: `?` unknown (not asked, or cannot
  tell), `—` every asked Instance listed all it runs and none runs it. An unreadable registry fails
  the listing.

## Issuer changes need consent

Each deployment is its own issuer, so installing a new deployment of an installed origin changes
its issuer:

| Change | Consent |
| --- | --- |
| First install of an origin | none |
| Same line: same Domain and Environment (next `development` preview, another version published from `production`) | `--allow-issuer-change` |
| Another line: another Environment, a production version over a staging preview, the first move from a legacy stable Worker | `--allow-issuer-change=<origin>` |
| Either, at a terminal | typing the origin when asked |

The replaced issuer keeps serving its in-flight work while it drains; `--revoke-previous` cuts it at
the activation. Without consent: ISSUER_CHANGE_NOT_CONSENTED before anything is sent;
`details.origins` lists every change.

## Authority an install needs

Kernel authority, separate from the registry's rights:

- Install needs the Kernel Role `domain.installer`, uninstall `domain.uninstaller` (both in
  `domain.manager` and `admin`). The registry's `domain_installer` and `domain_admin` are Admin
  rights on versions, not these Roles.
- The install poses what each release's `requirements({ roles, scopes })` requests (`policies.md`):

| Requested | The installer needs |
| --- | --- |
| A Role, Class or callable the Domain owns | nothing more |
| A membership on another Domain's Role | the right to grant it: `can_grant_extension` toward the Role, or ownership of its Class |
| A granter on a Role | the rights to grant and to revoke it |
| A membership on a Kernel Role (`graph.reader`, …) | Root, or a granter of the Role |
| A scope toward another Domain's callable or Class | nothing more |
| A scope toward a Kernel target | Root |
| Dropping any of these (upgrade, uninstall) | the right to remove it |

- Caller and executor, when they differ, must each pass. Otherwise
  `SCHEMA_REQUIREMENTS_UNSATISFIED`, `details.denials` naming each Edge Class and target. A `noop`
  install skips the check.

## Who owns a development instance

An Instance runs what its last install pinned; nothing locks it across machines, so two people
installing on one Instance replace each other's previews. One owner per Instance, a developer or
CI, never both: one development Instance per developer (each passes their own `-i`; Environments
name no Instance), and CI integration (staging installing every Domain together) on its own.

Every Environment deploys as the authenticated `astrale` CLI identity (`--as`). A line's first
deploy creates its Service, owned by that identity; an identity that neither is nor acts as the
owner (`extends_with`) is refused `service-owned-elsewhere`. Share a line by giving its Service to a
Group with the Service's `transfer` Method (`{ "owner" }`). `astrale()` refuses `organization`.

## Branch by branch

| Event | Command | Registry | Install |
| --- | --- | --- | --- |
| Feature branch or PR | `deploy development` | nothing | its owner's dev Instance, by URL |
| Push to the integration branch | `deploy staging` | nothing | staging, every Domain together, by URL |
| Merge of the release PR | `publish production` | version `1.5.0` | production: `install <origin>@1.5.0`, by hand or in CI behind an approval |
| Hotfix branch `release/1.4.x` | `publish production` | version `1.4.3` | the same; `diff` compares with 1.4.2 even if 2.0.0 exists |
| Chosen candidate or beta | `publish production` at `2.0.0-rc.1` | version `2.0.0-rc.1` | only by its exact number |

## Publish a version

The version lives in `package.json` (release-please or `npm version`); no command takes a number.

```sh
astrale-domain diff                  # changes since the published version and the minimum they require
npm version minor                    # writes 1.5.0 to package.json, with its commit and tag
astrale-domain publish production    # deploys, verifies, then creates the version 1.5.0
```

`publish <environment>`, in order:

1. Before any effect, refuses an Environment that does not deploy immutable deployments, a dirty
   tree, or no git commit (`--allow-dirty` marks the Publication dirty); warns when no remote branch
   holds the commit.
2. Reads the version and the registry. Same version, same release: success without effect. Same
   version, other release: refused (a published version never changes). An unregistered origin is
   claimed: Admin gives it to its first claimer, who administers its Domain; an origin another
   account holds is refused. A registry that does not answer is refused. No deploy before step 4.
3. Compares with the highest stable version below it; refuses a version too low, naming each change
   that requires more.
4. Deploys the release (or reuses its deployment) and verifies within 60 s that it serves the sealed
   release.
5. Asks Admin for the Publication under the Domain's lock. A version published meanwhile with
   another release is refused; this deployment stays a preview.

Publishing never installs: `astrale domain install <origin>@<version>` does.

- A failure leaves at most a deployment without a version and says whether a rerun can help; a
  rerun reuses the deployment and settles a Publication whose answer was lost. A refusal Admin would
  repeat (missing `domain_admin`, a release Admin will not name) names its cause.
- Semver without channels: code only or equivalent meaning → patch; additions only → minor; a
  member removed or changed → major; below 1.0.0 a breaking change raises the minor. `diff` gives a
  floor; a behaviour or authorization change at the same signature is the author's to raise.
- Pre-releases only for a chosen step (`2.0.0-rc.1`, a beta), never per Environment (no
  `1.5.0-staging.3`). A pre-release compares with the last stable version; no line reference ever
  chooses it. Publish from `production`; `publish staging` only for a beta that must run on test
  resources.
- Registry rights, held directly or through a Group (CI included): `domain_admin` to publish and
  yank, `domain_installer` to read versions (a public Domain grants it to the Public group).
- `diff`, `publish`, `yank` reach the registry through the `astrale` CLI's Admin target and identity
  (`--as <identity>` on `diff` and `publish`). `--json`: one report on stdout (DiffReportV1,
  PublishReportV1, YankReportV1); decide on the exit status.

### With release-please in CI

1. Every PR: `astrale-domain diff` reports the minimum the PR requires; informational (exit 0)
   while `package.json` still names a published version.
2. release-please opens the release PR: `fix` patch, `feat` minor, `!` major.
3. On that PR `diff` blocks: a version too low exits 1. Raise it with a `Release-As: 2.0.0` footer
   or a `feat!:` commit.
4. On merge, the workflow publishing the npm package runs `astrale-domain publish production`; the
   Domain's schema package carries the same number from the same `package.json`.

The SDK's composite GitHub Actions `domain-diff` and `domain-publish` (`actions/` in the
`astrale-os/sdk` repository) run steps 1, 3 and 4, with two CI identities: one holding
`domain_installer` for the PR diff, one holding `domain_admin` in a protected `production` GitHub
Environment for the publish. release-please must open its PR with a token that starts workflows,
or the diff never runs on it.

## Install a version, roll back, yank

```sh
astrale domain versions issues.example                                          # every published version
astrale domain install issues.example@1.5 -i acme-prod                          # highest stable 1.5.x
astrale domain install issues.example@1.5.0 --allow-issuer-change -i acme-prod  # an upgrade, scripted
astrale domain install projects.example@1.5.0 teams.example@2.0.0 --allow-issuer-change -i acme-prod
astrale domain install issues.example@1.4.2 --allow-issuer-change -i acme-prod  # rollback
astrale-domain yank 1.5.0                                                       # --undo puts it back
```

- `@1.5.0` / `@2.0.0-rc.1`: exactly that version, pre-release or yanked included (yanked installs
  with a warning). `@1.5`: highest stable, non-yanked 1.5.x. A major alone (`@1`), a range or build
  metadata is refused. Syntax decides: a version goes to the registry, a URL installs as is; both
  mix in one install.
- The CLI reads the registry as your identity: a private Domain needs `domain_installer`; one you
  cannot read is reported not found. The version resolves to its deployment URL and release digest;
  the CLI checks the deployment still serves that release (else PUBLICATION_RELEASE_MISMATCH). Admin
  unavailable: a version reference fails before any install; URLs alone read Admin only to propose
  a compatible version of a dependent the pre-check finds broken.
- A rollback is an ordinary install (the old deployment still serves); refused
  `DATA_MIGRATION_REQUIRED` when data written since cannot be carried back.
- A fix is a new version installed on each Instance; no code is swapped under a published URL.
- Yanking stops line references from choosing a version; installations and its deployment keep
  running. Retiring a deployment (it then answers DEPLOYMENT_RETIRED) is separate and strands the
  durable runs it started (`workflows.md`, Deploy and evolve).

## Secrets of a deployment

Secrets belong to the publisher: each Environment declares its secrets file
(`astrale({ secrets: '.env.staging' })`); no Instance supplies secrets to a Domain it installs.

- A deploy binds the Environment's current secrets to the new deployment only.
- Values rotate in place: script, URL, issuer and key unchanged, no reinstall. Adding or removing a
  secret name is a new release.
- Never pass a value in argv (`ps`, shell history): a private file (`umask 077`) outside the
  repository, or a pipe from the secret manager.

### Rotate the current deployment

`astrale-domain list --environment production --json` gives each deployment's `current` flag and
call targets. `callTarget.service` names the owning
`@<serviceId>::services.astrale.ai:class.CloudflareService`, whose `setSecret` changes **only the
Service's current deployment**, even when selected from a historical row. `callTarget.path` names a
`CloudflareDeployment` (retirement; no `setSecret`). Call on the Admin instance (`--admin`, or
`--admin=<bookmark>` when `callTarget.admin` names one) as the Service owner or an identity
authorized to act as it; `SERVICE_NODE_ID` is the part of `callTarget.service` between `@` and `::`:

```sh
astrale-domain list --environment production --json
astrale call "@${SERVICE_NODE_ID}::services.astrale.ai:class.CloudflareService.method.setSecret" \
  --admin -d @rotate.json --json          # rotate.json: {"name":"API_TOKEN","value":"..."}, protected, outside the repo
read-new-secret | jq -Rs '{ name: "API_TOKEN", value: rtrimstr("\n") }' \
  | astrale call "@${SERVICE_NODE_ID}::services.astrale.ai:class.CloudflareService.method.setSecret" \
      --admin -d - --json
```

- Reply `{ "name": "API_TOKEN" }`; propagation takes seconds. `secret-undeclared`: the current
  release declares no such name. `service-unavailable` may carry `retryAfter`.
- The Method follows current, not a pinned deployment: recheck `current` before a retry and after
  success (the reply cannot prove which deployment was rotated if a promotion raced). Verify the
  intended deployment's behavior after propagation without reading secrets back.

### Rotate a historical Domain deployment

Identical-release redeploy; not interruption-free:

1. Pause concurrent deploy/promotion pipelines for the Service. List deployments; keep the
   historical label/URL, the current label as `PREVIOUS_LABEL`, the Service node id as
   `SERVICE_NODE_ID`.
2. Recover the exact source and build inputs (pinned dependencies, toolchain, frozen configuration;
   the listed commit helps but cannot recover uncommitted changes) and the complete declared secret
   set with updated values. A changed build or configuration creates another deployment and leaves
   the historical secrets untouched.
3. `astrale-domain deploy <environment> --json` from that project. Require the original `url` and
   `deployment.script` (label), `deployment.state: "reused"`, `secrets.state: "updated"`
   (`unchanged` only when those exact values were already applied).
4. The Domain adapter promotes on every deploy, so the stable Service URL and cron target point
   at the old release (consumers pinned to deployment URLs are unaffected). Recheck `current` (it
   should be this redeploy; if another actor promoted, resolve it with them), then restore:

```sh
astrale call "@${SERVICE_NODE_ID}::services.astrale.ai:class.CloudflareService.method.promote" \
  label="$PREVIOUS_LABEL" --admin --json
astrale-domain list --environment production --json
```

- After an unexpected identity or partial failure, inspect current and restore the prior label
  under the same concurrency check. A `created` result left an unwanted active deployment: after
  restoring current, retire exactly it if unused. Verify stable routing, cron target and the
  intended deployment's behavior after propagation.
- Deployments made before the Worker-request contract can get another label from current tooling
  even for the same source, and that deploy does not rotate their secrets: retire unused ones or use
  an operator-supported remediation. A historical deployment no consumer or in-flight work needs can
  be retired instead; never retire a published or pinned release blindly.
- Generic Workers with a retained exact deploy input can `deployWorker` with `promote: false`
  ([Services workflow](../../astrale-services/references/workflows.md)); the Domain adapter has no
  such option, and rebuilding a Domain upload through `readWorkerDirectory` is not equivalent.
- A deployment in a platform dispatch namespace (adapter-cloudflare `namespace` mode) has no
  Services node: its operators rotate it with that namespace's per-script tooling, reading the value
  on stdin (`pnpm provider:platform-secret -- --label <label> --name <NAME> < value-file` in the
  Services package of the `domains` repository), or by an identical redeploy.

After a leak: put the new value in the secrets file and every CI secret store first (an identical
redeploy with the old value would write it back), rotate every deployment still serving, then
revoke the old value where it was issued.
