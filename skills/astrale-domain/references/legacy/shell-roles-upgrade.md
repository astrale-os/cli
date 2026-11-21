# Upgrading an instance to Shell Roles — subclass model (deprecated)

> **Deprecated (L-CLI-2).** This page moves an instance whose Shell predates Shell Roles (Core
> groups "Administrators", "Members", "Applications" and "View only", `member_of_group`, accounts
> carrying `claimedEmail`/`claimedName`, Views given through the Shell's own `view_access`) to a
> Shell with Roles, through the two migration Functions that Shell keeps for this move.
> **Replaced by** nothing: an instance created on a Shell with Roles never needs it;
> [the accounts reference](../users.md) describes the result. **Removal:** the Shell major release that removes
> `legacyMigrateAccounts` and `legacyMigrateViewAccess`.

The move is one install and two calls, by an operator, one instance at a time. Domains that extend
Shell `User` or `Group` stay installed and are not rebuilt.

## What changes

| Stored before | After the install | After the migrations |
| --- | --- | --- |
| Core group "Administrators" and its members | The group is a member of `workspace.admin`, by release: its members hold it with no data change | Same |
| Core group "Members" | Member of `workspace.member` | Same |
| Core groups "Applications", "View only" | Members of Kernel `reader`, with no profile | Same |
| `member_of_group` | Still written beside `extends_with` when an account joins a legacy Core group, removed when it leaves any group | Same |
| `claimedEmail`, `claimedName` on accounts | Kept; `email`, `name` absent | `email`, `name` written where absent; a profile for every account and named group |
| The Shell's `view_access` Edges | Kept; the Kernel opens a View only through its own `view_access` | Copied to the Kernel's `view_access`, then deleted |

For Domains built against the subclass model, and for administrators:

- **Administrators lose direct Mutations on `User`, `Group` and `member_of_group`.** The Class
  grants the previous release gave the "Administrators" group are revoked by the install; every
  write goes through the Shell methods (`User.create`, `User.update`, `Group.assignMember`, …).
  Find the scripts and tools that mutate these Classes directly before installing.
- **A group of a Domain's `Group` subclass changes members under the caller's own authority.**
  Shell writes its membership as the caller, not as itself: call it through the owner Domain's own
  callable. An administrator calling `Group.assignMember` on such a group directly is refused with
  an undeclared error (code 5000). Groups of the Shell's own Class are unaffected.
- **Accounts of a `User` subclass get no profile.** Members read profiles only (`user-profile.reader`),
  so they do not see those accounts' names and pictures; administrators read the accounts
  themselves (`user.reader`).
- Calls of the deprecated forms keep working: `User.invite({ user, email })`, `User.recordProfile`,
  `listEntrypoints` and `assignViews`.

## Before installing

- **Root.** The release makes `workspace.admin` a member of Kernel `admin`, which only Root grants,
  and asks for a scope on the Kernel `extends_with` Class: the install runs under Root
  (`astrale instance root import <slug> --yes`, then `--as <slug>-root`).
- **A recovery point.** Ask the Host operator for a backup of the Host taken just before the
  install, and its time. It is the only rollback: reinstalling the previous Shell does not restore
  the revoked administrator grants. A restore returns every instance of the Host to that point.
- **The version.** `astrale domain versions shell.astrale.ai --json` lists the published versions;
  `astrale introspect shell.astrale.ai -i <slug> --as <slug>-root --json` shows the installed one.
- **Rehearse** on an instance holding a representative number of accounts: the account migration's
  time grows with it.
- **A baseline**, kept for the comparison after (page with `--cursor` beyond `--limit`):

```sh
astrale query --class /:shell.astrale.ai:class.User --limit 1000 --json -i <slug> --as <slug>-root
astrale query --class /:shell.astrale.ai:class.Group --limit 1000 --json -i <slug> --as <slug>-root
astrale query /:shell.astrale.ai:core.admin --edge /:kernel.astrale.ai:class.extends_with \
  --direction incoming --json -i <slug> --as <slug>-root
```

Repeat the last read for `core.member`, `core.applications` and `core.view-only`, and for each
Domain Class extending `User` or `Group`. Record, for a sample of people of each profile, one
allowed and one refused call under their own identity: Root success proves nothing about a
person's access.

## Install

```sh
astrale domain install shell.astrale.ai@<version> -i <slug> --as <slug>-root \
  --allow-issuer-change=shell.astrale.ai \
  --validation-scope full --validation-counts exact --json </dev/null
```

- `--allow-issuer-change=shell.astrale.ai` consents to the new release being served by another
  issuer than the installed one.
- Full validation re-checks every stored account and group against the new Schema and counts
  every failure; a refusal names them and changes nothing.
- Exit 0 is done or still running: follow a running install with `astrale execution status`
  (`references/deployment.md`).

## Migrate the accounts

```sh
astrale call /:shell.astrale.ai:function.legacyMigrateAccounts -d '{}' --json \
  -i <slug> --as <slug>-root </dev/null
```

- Admitted to `workspace.admin` and Root. It answers `{ migrated, conflicts, profiles }`: the
  accounts given an `email` or `name`, the accounts left without one, and the profiles created.
- **Run it only where sign-in recorded the email the identity provider verified.** `claimedEmail`
  is what each account recorded about itself; read them in the baseline and check them first.
- It is an Action: on a large instance a call stops at the invocation deadline (about 25 s, code
  4005). The work done before stays written. Call again until one answers `migrated: 0` and
  `profiles: 0`; that confirming call still reads every account.
- Each conflict `{ user, email }` is an account whose claimed email another account holds: it keeps
  no email. Decide which account the person signs in to, then give the other one its own email with
  `astrale call @<user>::shell.astrale.ai:class.User.method.update email=… --as <slug>-root`.
- An account with neither name nor email gets a profile named `Compte sans nom` until it is
  renamed.

## Migrate View access

```sh
astrale call /:shell.astrale.ai:function.legacyMigrateViewAccess -d '{}' --json \
  -i <slug> --as <slug>-root </dev/null
```

- Admitted to `workspace.admin` and Root. It answers `{ copied, removed }`: Kernel Edges created,
  Shell Edges deleted. Run it right after the install: until then, a person given a View only
  through the Shell's Edge does not open it.
- Batches of 200 Edges, each copying and deleting in one write, so a View is never given by
  neither Edge. A failed batch stops the call with `run it again`; a second run answers
  `copied: 0, removed: 0`.

## Verify

- Repeat the baseline reads and compare: the same accounts and groups; `core.admin` and
  `core.member` now extend `workspace.admin` and `workspace.member`; `email` and `name` on every
  account the migration reported; as many Kernel `view_access` Edges as Shell Edges before.
- Repeat the allowed and refused calls of each sampled person, and one administrator task through
  the Shell methods.
- `astrale logs -i <slug> --as <slug>-root --topic function.invoke` shows the calls and refusals.

## Roll back

Ask the Host operator to restore the recovery point taken before the install. Every change made on
the Host after it is lost, on every instance of the Host. Reinstalling the previous Shell version is
not a rollback: it leaves the administrator grants the install revoked.
