# Deploy, install, and publish

Three commands, one effect each. The SDK binary `astrale-domain`, run in the Domain project, deploys
and publishes; the `astrale` CLI installs. Only an install changes what an instance runs.

| Command | Creates a deployment | Names a version | Changes an instance |
| --- | --- | --- | --- |
| `astrale-domain deploy <environment>` | yes | no | no |
| `astrale-domain publish <environment>` | yes, deploy included | yes, the `package.json` version | no |
| `astrale domain install <reference>... -i <instance>` | no | no | yes |

`astrale-domain build`, `diff` and `list`, and `astrale domain versions`, only read.

## Deploy, then install

```sh
pnpm run deploy development                 # astrale-domain deploy development: prints the deployment URL
astrale domain install <url> -i acme-dev    # pin that release on the instance
```

- A deploy makes one immutable deployment of one release (the build with the Environment's frozen
  configuration) at its own URL, `https://<line>-<content>.<routing domain>`, with a signing key
  generated for it. The line comes from the origin and the Environment; the content covers the
  build and the configuration. Redeploying the same release reuses its deployment; other code,
  another variable or another set of secret names gives another URL. Earlier deployments keep
  serving at their own URLs.
- A deployment without a version is a preview. It is never in the registry, it is installed by
  URL, and it expires 30 days after its activation or its last call, whichever is later. Publish a
  release to keep it.
- `deploy --json` prints one DeployResultV1 on stdout (its `url` is what install takes); progress
  goes to stderr. `astrale-domain list` shows the deployments of the Project's Environments, each
  named by the registry's version of its release (`1.5.0`) or of its build (`1.5.0 · staging`), else
  by a name computed from its commit (`1.4.2 + 7 commits · a1b2c3d · staging`), with its last call
  and expiry. `--instance <name>` (repeatable) asks those instances what they run for its INSTALLED
  ON column: `?` is unknown (an instance not asked, or one that cannot tell), `—` means every
  instance asked listed all it runs and none runs it. A registry it cannot read fails the listing
  (SDK 0.6.0-beta.17 and astrale CLI 1.0.0-beta.129 or newer; older SDKs show computed names only).
- Install Domains that move together in ONE grouped install, which is atomic and mixes URLs and
  versions. Never chain one-Domain installs for a coherent set:

```sh
URL_A=$(pnpm --dir projects exec astrale-domain deploy staging --json | jq -r .url)
URL_B=$(pnpm --dir teams exec astrale-domain deploy staging --json | jq -r .url)
astrale domain install "$URL_A" "$URL_B" --allow-issuer-change -i acme-stg
```

- The URL is already a pin: the CLI reads the release it serves and pins its release digest, and
  the Kernel refuses any other (`SCHEMA_REVISION_CONFLICT`). The Kernel installs only a DomainRelease
  v4. A deployment URL never serves other code, so new code reaches an instance only through an
  install of its new URL or version.

## Issuer changes need consent

Each deployment is its own issuer. Installing a new deployment of an installed origin changes its
issuer, which is never silent:

- same line, a new deployment of the same Domain and Environment (the next `development` preview,
  or another version published from `production`): `--allow-issuer-change`;
- another line (another Environment, a production version over a staging preview, or the first move
  from a legacy stable Worker): `--allow-issuer-change=<origin>`, the origin only after `=`;
- at a terminal, typing the origin when asked confirms either.

The first install of an origin needs no consent. The replaced issuer keeps serving its in-flight work
while it drains; `--revoke-previous` cuts it at the activation. Without consent the install fails
with ISSUER_CHANGE_NOT_CONSENTED before anything is sent, and `details.origins` lists every change.

## Authority an install needs

The Kernel decides an install by Kernel authority, separate from the registry's rights:

- Installing needs the Kernel Role `domain.installer`, uninstalling `domain.uninstaller` (both in
  `domain.manager` and `admin`). The registry's `domain_installer` and `domain_admin` are Admin
  rights on versions, not these Roles.
- The install poses what each release's `requirements({ roles, scopes })` requests (`policies.md`).
  Toward a Role, Class, or callable the Domain owns, nothing more is needed. A membership on another
  Domain's Role needs the right to grant it: `can_grant_extension` toward the Role, or ownership of
  its Class; a granter needs the rights to grant and to revoke it. For a Kernel Role, such as
  `graph.reader`, that is Root or a granter of the Role. A scope toward another Domain's callable or
  Class needs nothing more; a scope toward a Kernel target needs Root. Dropping one on an upgrade or
  uninstall needs the right to remove it.
- The caller and the authenticated principal, when they differ, must each pass. Otherwise the
  install is refused `SCHEMA_REQUIREMENTS_UNSATISFIED`, with `details.denials` naming each Edge Class
  and target. An install that changes nothing (`noop`) skips this check.

## Who owns a development instance

An instance runs what its last install pinned, and nothing locks it between machines: two people
installing on one instance replace each other's previews. Give each instance one owner, a developer
or CI, never both:

- one developer: one development instance;
- several developers: one instance each. Environments name no instance, so each developer passes
  their own `-i <instance>` and nothing in `astrale.config.ts` changes;
- CI integration, such as staging installing every Domain of the repository together: an instance
  of its own.

Deployments are per developer anyway: each build is its own deployment, so previews never replace
each other. Their line is per origin and Environment, though, and it belongs to one organization,
first come. A team that shares `development` names an `organization` there too (a Shell Group whose
members deploy for it); without one, the line belongs to whoever deployed first, and the others are
refused `line-owned-elsewhere`.

## Branch by branch

| Event | Command | Registry | Install |
| --- | --- | --- | --- |
| Feature branch or PR | `deploy development` | nothing | its owner's dev instance, by URL |
| Push to the integration branch | `deploy staging` | nothing | staging, every Domain together, by URL |
| Merge of the release PR | `publish production` | version `1.5.0` | production: `install <origin>@1.5.0`, by hand or in CI behind an approval |
| Hotfix branch `release/1.4.x` | `publish production` | version `1.4.3` | the same; `diff` compares with 1.4.2 even if 2.0.0 exists |
| Chosen candidate or beta | `publish production` at `2.0.0-rc.1` | version `2.0.0-rc.1` | only by its exact number |

## Publish a version

The version lives in `package.json`, written by release-please or `npm version`; no command takes a
number.

```sh
astrale-domain diff                  # changes since the published version and the minimum they require
npm version minor                    # writes 1.5.0 to package.json, with its commit and tag
astrale-domain publish production    # deploys, verifies, then creates the version 1.5.0
```

`publish <environment>`, in order:

1. Before any effect, refuses an Environment that does not deploy immutable deployments, a working
   tree with changes, or no git commit (unless `--allow-dirty`, which marks the Publication dirty),
   and warns when no remote branch holds the commit.
2. Reads the version and the registry. The same version naming the same release succeeds without
   effect; naming another release it is refused: a published version never changes, raise it.
3. Compares with the highest stable version below it and refuses a version too low, naming each
   change that requires more.
4. Deploys the release, or reuses its deployment, and verifies within 60 seconds that it serves
   the sealed release.
5. Asks Admin for the Publication, under the Domain's lock. A version published meanwhile with
   another release is refused, and this deployment stays a preview.

A failure leaves at most a deployment without a version, and says whether a rerun can help. When
it can, rerun `publish`, which reuses the deployment; an answer that was lost may already have
created the Publication, and the rerun settles it. A refusal Admin would repeat, such as a missing
`domain_admin` right or a release Admin will not name, names its cause instead. With Admin
unavailable, or a Domain absent from the registry, nothing is deployed. Publishing never installs.
When Admin created the version but could not keep its deployment from expiring, `publish` still
exits 0 and warns on stderr with the exact request to send again; until then that deployment can
expire like a preview.

- Semver without channels. Code only or an equivalent meaning: patch; additions only: minor; a
  member removed or changed: major; below 1.0.0 a breaking change raises the minor. `diff` gives a
  floor: a behaviour or authorization change at the same signature is the author's to raise.
- Pre-releases only for a chosen step (`2.0.0-rc.1`, a beta for testers), never per Environment (no
  `1.5.0-staging.3`). A pre-release compares with the last stable version, and no line reference
  ever chooses it. Publish from `production`; `publish staging` only for a beta that must run on
  test resources.
- An Astrale operator creates the Domain in the registry and names its first administrator.
  Publishing and yanking require the registry right `domain_admin`, reading versions
  `domain_installer` (a public Domain grants it to the Public group); both can be held through a
  Group, CI included.
- `diff`, `publish` and `yank` reach the registry through the `astrale` CLI, with its Admin target and
  identity (`--as <identity>` on `diff` and `publish`). `--json` prints one report on stdout
  (DiffReportV1, PublishReportV1, YankReportV1); decide on the exit status.

### With release-please in CI

1. On every PR, `astrale-domain diff` reports the minimum the PR requires. While `package.json` still
   names a published version, as on a feature branch, the report is informational and exits 0.
2. release-please opens the release PR with the version from the commits: `fix` patch, `feat`
   minor, `!` major.
3. On that PR, `diff` is a blocking check: a version too low exits 1. Raise it with a
   `Release-As: 2.0.0` footer or a `feat!:` commit.
4. On merge, the workflow that publishes the npm package runs `astrale-domain publish production`.
   The Domain's schema package carries the same number, from the same `package.json`.

The SDK's composite GitHub Actions `domain-diff` and `domain-publish` (`actions/` in the
`astrale-os/sdk` repository) run steps 1, 3 and 4. Give them two CI identities: one holding
`domain_installer` for the diff on pull requests, one holding `domain_admin`, kept in a protected
`production` GitHub Environment, for the publish after the release merge. release-please must open
its PR with a token that starts workflows, or the diff never runs on it.

## Install a version, roll back, yank

```sh
astrale domain versions issues.example                                          # every published version
astrale domain install issues.example@1.5 -i acme-prod                          # highest stable 1.5.x
astrale domain install issues.example@1.5.0 --allow-issuer-change -i acme-prod  # an upgrade, scripted
astrale domain install projects.example@1.5.0 teams.example@2.0.0 --allow-issuer-change -i acme-prod
astrale domain install issues.example@1.4.2 --allow-issuer-change -i acme-prod  # rollback
astrale-domain yank 1.5.0                                                       # --undo puts it back
```

- `@1.5.0`, or `@2.0.0-rc.1`, is exactly that version, a pre-release or a yanked one included (a
  yanked one installs with a warning); `@1.5` is the highest stable 1.5.x that is not yanked. A
  major alone (`@1`), a range or build metadata is refused. The syntax decides: a version goes to
  the registry, a URL is installed as is, and both mix in one install.
- The CLI reads the registry with your own identity: a private Domain needs `domain_installer`,
  held directly or through a Group, and one you cannot read is reported as not found. The version
  becomes its deployment URL and release digest; the CLI checks that the deployment still serves
  that release (else PUBLICATION_RELEASE_MISMATCH), and the Kernel refuses any other. If Admin
  cannot answer, a version reference fails before any install; URLs alone read Admin only to
  propose a compatible version of a dependent the install pre-check finds broken.
- A rollback is an install like any other: the old version's deployment still serves. The Kernel
  refuses it (DATA_MIGRATION_REQUIRED) when data written since cannot be carried back.
- A fix reaches instances as a new version of the same Schema, installed on each instance; no code is
  ever swapped under a published URL.
- Yanking stops line references from choosing a version: installations keep running and its
  deployment keeps serving. Retiring a deployment, which then answers DEPLOYMENT_RETIRED, is another
  act; it strands the durable runs the deployment started (`workflows.md`, Deploy and evolve).

## Secrets of a deployment

Secrets belong to the publisher: each Environment declares its secrets file (`astrale({ secrets:
'.env.staging' })`), and no instance provides secrets to a Domain it installs.

- A deploy binds the Environment's current secrets to the new deployment only; every other
  deployment keeps its own.
- Secret values can rotate in place while the deployment keeps its script, URL, issuer and key,
  so consumers do not reinstall. Adding or removing a secret name is a new release.
- Never pass a secret value in argv, where `ps` and shell history keep it: write it to a private file
  (`umask 077`) outside the repository, or pipe it from your secret manager.

With `@astrale-os/adapter-astrale` 0.5.0-beta.171 or newer,
`astrale-domain list --environment production --json` includes each Deployment's `current` flag and two call targets. `callTarget.service` names the owning
`@<serviceId>::services.astrale.ai:class.CloudflareService`; its `setSecret` changes **only the
Service's current deployment**. `callTarget.path` names a `CloudflareDeployment` for retirement;
that class has no `setSecret` Method. Selecting a historical row's Service still targets current,
not that historical deployment.

To rotate current, inspect the list and take the bare Service node ID from `callTarget.service`
(the part between `@` and `::`) as `SERVICE_NODE_ID`.
Call on the Admin instance (`--admin`, or `--admin=<bookmark>` when `callTarget.admin` names one)
as the Service owner or an identity authorized to act as that owner. Put
`{"name":"API_TOKEN","value":"..."}` in a protected file outside the repository (referenced as
`rotate.json` below), or pipe the output of your secret manager (`read-new-secret` below):

```sh
astrale-domain list --environment production --json
astrale call "@${SERVICE_NODE_ID}::services.astrale.ai:class.CloudflareService.method.setSecret" \
  --admin -d @rotate.json --json
read-new-secret | jq -Rs '{ name: "API_TOKEN", value: rtrimstr("\n") }' \
  | astrale call "@${SERVICE_NODE_ID}::services.astrale.ai:class.CloudflareService.method.setSecret" \
      --admin -d - --json
```

The reply is `{ "name": "API_TOKEN" }`; provider propagation takes a few seconds.
`secret-undeclared` means the current release declares no such name; `service-unavailable` may
include `retryAfter`. Recheck which deployment is current before retrying: this Method follows
current, not a pinned deployment. Recheck `current` after success as well: the reply names only
the secret, so it cannot prove which deployment was rotated if promotion raced with the call.
Verify the intended deployment's real behavior after propagation without reading back secrets.

To rotate a historical **Domain** deployment, use the supported identical-release redeploy:

1. Pause concurrent deployment/promotion pipelines for this Service during the rotation window.
   List deployments and retain both the historical label/URL and the Service's current label.
   Keep the current label as `PREVIOUS_LABEL` and the Service node ID as `SERVICE_NODE_ID`.
2. Recover the original source and build inputs, including the same pinned dependencies,
   toolchain and frozen configuration. The listed record's commit helps locate them; a commit
   alone cannot recover uncommitted changes. Supply the complete declared secret
   set with updated values. A changed build or configuration creates another deployment and
   leaves the historical secrets untouched.
3. Run `astrale-domain deploy production --json` from that Domain project (substitute its actual
   environment). Require the original `url` and `deployment.script` (label),
   `deployment.state: "reused"`, and `secrets.state: "updated"`; `unchanged` is appropriate only
   when those exact values were already applied.
4. Recheck `current` immediately before restoring: it should be the deployment this redeploy
   selected. If another actor promoted something else, resolve that change with them instead of
   silently rolling it back. Restore the previously current label, then list and confirm `current`:

```sh
astrale call "@${SERVICE_NODE_ID}::services.astrale.ai:class.CloudflareService.method.promote" \
  label="$PREVIOUS_LABEL" --admin --json
astrale-domain list --environment production --json
```

The Domain adapter promotes on every deploy, including an identical historical release. The
stable Service URL and cron target therefore move to the old release during this window;
consumers pinned to immutable deployment URLs keep their releases. After an unexpected identity
or partial failure, inspect current and restore the prior label under the same concurrency check.
If the result was `created`, an unwanted new active deployment remains: after restoring current,
retire that exact new deployment if it is not wanted or in use. Verify stable routing,
cron target, and the intended deployment's behavior after secret propagation. This is not a
no-interruption rotation procedure. Deployments made before the Worker-request contract can get
a different label with current tooling even for the same source. Their secrets are not rotated by
that new deploy: retire unused legacy deployments or use an operator-supported remediation.
A historical deployment that no consumer or in-flight work needs can instead be explicitly retired; do not retire a published or pinned release blindly.

Generic Workers with a retained exact deploy input can use `deployWorker` with `promote: false`
(see the [Services workflow](../../astrale-services/references/workflows.md)). The Domain adapter
does not expose this option; reconstructing a Domain upload through `readWorkerDirectory` is not
an equivalent supported path.

A deployment in the platform dispatch namespace (adapter-cloudflare `namespace` mode: Shell, the
Services runtime and the other platform Domains) has no Services node. Services operators rotate it
with that namespace's per-script tooling, which reads the value on stdin
(`pnpm provider:platform-secret -- --label <label> --name <NAME> < value-file` in the Services
package of the `domains` repository), or by deploying the identical release again.

After a leak, put the new value in the secrets file and every CI secret store first (an identical
redeploy with the old value would write it back), rotate every deployment that still serves, then
revoke the old value where it was issued.
