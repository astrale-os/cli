# Upgrading an instance to Shell Roles — subclass model (deprecated)

> **Deprecated (L-CLI-2).** This page moves an instance whose Shell predates Shell Roles (Core
> groups "Administrators", "Members", "Applications" and "View only", `member_of_group`, accounts
> carrying `claimedEmail`/`claimedName`, Views given through the Shell's own `view_access`) to a
> Shell with Roles, through the two migration Functions that Shell keeps for this move.
> **Replaced by** nothing: an instance created on a Shell with Roles never needs it;
> [the accounts reference](../users.md) describes the result. **Removal:** the Shell major release that removes
> `legacyMigrateAccounts` and `legacyMigrateViewAccess`.

The move is one install and two calls, by an operator, one instance at a time, under the instance's
Root. Domains that extend Shell `User` or `Group` stay installed and are not rebuilt. The commands
below need the `astrale` CLI, `jq` and a POSIX shell; each step ends with the read that verifies it.

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
- **Accounts of a `User` subclass are migrated with the Shell's own.** The account migration reads
  every account, subclasses included, and gives each a profile; it reads and compares only the
  Shell's properties, never the subclass's own (see [Duplicate people](#duplicate-people)).
- Calls of the deprecated forms keep working: `User.invite({ user, email })`, `User.recordProfile`,
  `listEntrypoints` and `assignViews`.

## Before installing

### Root and the working directory

The release makes `workspace.admin` a member of Kernel `admin`, which only Root grants, and asks for
a scope on the Kernel `extends_with` Class: every command below runs under the instance's Root.

```sh
astrale instance root import <slug> --yes   # imports the identity <slug>-root
SLUG=<slug>; ROOT="$SLUG-root"
mkdir -p shell-upgrade/before shell-upgrade/after && cd shell-upgrade

# pages <jq filter> <query arguments...>: one Query across every page, under Root.
pages() {
  filter=$1; shift; cursor=
  while :; do
    if [ -z "$cursor" ]; then
      page=$(astrale query "$@" --limit 500 --json -i "$SLUG" --as "$ROOT" </dev/null) || return 1
    else
      page=$(astrale query "$@" --limit 500 --cursor "$cursor" --json -i "$SLUG" --as "$ROOT" </dev/null) || return 1
    fi
    printf '%s\n' "$page" | jq -rc "$filter"
    cursor=$(printf '%s\n' "$page" | jq -r '.page.next // empty')
    [ -n "$cursor" ] || return 0
  done
}

# The Shell's and the Kernel's view_access Edges, as (identity, View) pairs.
for origin in shell.astrale.ai kernel.astrale.ai; do
  printf '{"format":"astrale.graph.query","version":"v6","source":{"kind":"edge","terms":[{"kind":"class","class":{"origin":"%s","kind":"class","name":"view_access"}}],"bindings":{"source":"n0","edge":"e0","target":"n1"}},"steps":[],"select":{"kind":"edges","binding":"e0","projection":{"edge":"reference","source":"reference","target":"reference"}}}\n' \
    "$origin" > "view-access.$origin.json"
done
PAIRS='.edges[] | [.source.value.id, .target.value.id] | @tsv'
```

`astrale query --edge` answers the neighbour Nodes of its source, never Edges; the two Query
documents above select the Edges themselves, as `{ edge, source, target }` references.

### The version and the release

A version reference (`shell.astrale.ai@<version>`) and the VERSION column of `domain list` are read
in the Admin registry under the identity of the command (`--as`, else the default identity). An
instance's Root is not an Admin identity: under `--as "$ROOT"` both are refused
`REGISTRY_FORBIDDEN`. Read the registry under the default identity, and install the release by its
deployment URL:

```sh
VERSION=<version>
astrale domain versions shell.astrale.ai --json \
  | jq -r --arg v "$VERSION" '.publications[] | select(.version == $v) | [.url, .releaseDigest, .yanked] | @tsv'
URL=<url>; DIGEST=<releaseDigest>

# The installed Shell: --creds authenticates the instance only; the registry is read as you.
astrale domain list -i "$SLUG" --creds "$(astrale token --raw -i "$SLUG" --as "$ROOT")" --json \
  | jq '.domains[] | select(.origin == "shell.astrale.ai") | {version, name, pin}'
```

The page applies to an installed Shell without Roles (the `0.1` line); install a version whose
`yanked` is `false`.

### A recovery point

A restore of the Host is the only rollback ([Roll back](#roll-back)). Confirm with the Host operator
that the Host is backed up, and record the instance a restore names; the instant is recorded at the
install:

```sh
astrale instance status "$SLUG" --json | jq '{slug, id, hostId}' > before/instance.json
```

### A rehearsal

Run the whole page first on an instance holding a representative number of accounts: the account
migration's time grows with it.

### The baseline

```sh
pages '.graph.nodes[]' --class /:shell.astrale.ai:class.User > before/users.jsonl
pages '.graph.nodes[]' --class /:shell.astrale.ai:class.Group > before/groups.jsonl
mkdir -p before/members
for id in $(jq -r .id before/groups.jsonl); do
  pages '.graph.nodes[].id' "@$id" --edge /:kernel.astrale.ai:class.extends_with \
    --direction incoming | sort > "before/members/$id"
done
pages "$PAIRS" --file view-access.shell.astrale.ai.json | sort > before/view-access.tsv
wc -l before/users.jsonl before/groups.jsonl before/view-access.tsv
```

The Group extent includes the four Core groups and every group of a Domain's `Group` subclass; each
file of `before/members` lists the accounts and groups that extend one group. The four Core groups'
ids:

```sh
for core in admin member applications view-only; do
  printf '%s %s\n' "$core" "$(pages '.graph.nodes[].id' "/:shell.astrale.ai:core.$core")"
done | tee before/core-groups
```

### The claimed emails

`claimedEmail` and `claimedName` are what each account recorded about itself through
`User.recordProfile`; nothing records whether an identity provider verified them. The GUI records,
at each sign-in, the email and name of the identity provider's session; any other client holding the
account's credential can record any value. The migration makes the claimed email the account's
`email`, the key that binds a first sign-in to it. Read which issuer each account authenticates with
(`iss`) and which accounts claim an email:

```sh
jq -s 'group_by(.props["kernel.astrale.ai:class.Identity.property.iss"])
  | map({iss: .[0].props["kernel.astrale.ai:class.Identity.property.iss"], accounts: length,
         claiming: map(select(.props["shell.astrale.ai:class.User.property.claimedEmail"])) | length})' \
  before/users.jsonl
```

Accounts sharing the identity provider's issuer signed in through it; check by hand every claimed
email of an account with another issuer or none (an operator key, an imported identity), and fix it
after the migration with `User.update` ([Conflicts and unnamed accounts](#conflicts-and-unnamed-accounts)).

### Duplicate people

The migration compares a claimed email only with the Shell `email` of the other accounts. An account
whose claimed email is held, under a Property of its own Domain, by an account of a `User` subclass
is not reported: both stay, one person with two accounts. List such pairs:

```sh
jq -rs '
  def norm: gsub("^\\s+|\\s+$"; "") | ascii_downcase;
  . as $all
  | .[] | select(.props["shell.astrale.ai:class.User.property.claimedEmail"] | type == "string")
  | (.props["shell.astrale.ai:class.User.property.claimedEmail"] | norm) as $email
  | .id as $claimer
  | $all[] | select(.id != $claimer) | . as $other
  | .props | to_entries[]
  | select((.key | startswith("shell.astrale.ai:") or startswith("kernel.astrale.ai:")) | not)
  | select((.value | type) == "string" and (.value | norm) == $email)
  | [$claimer, $other.id, $other.class, .key, $email] | @tsv' before/users.jsonl
```

The Domain that owns the subclass decides which account the person keeps, through its own callables.

## Install

```sh
date -u +%Y-%m-%dT%H:%M:%SZ > before/instant      # the recovery point a restore goes back to
astrale domain install "$URL" -i "$SLUG" --as "$ROOT" \
  --allow-issuer-change=shell.astrale.ai \
  --validation-scope full --validation-counts exact --json </dev/null > after/install.json
jq '{changed, execution, follow, pins: [.references[]? | {expected: .pin.release, installed: .installed.pin.release}]}' \
  after/install.json
```

- `--allow-issuer-change=shell.astrale.ai` consents to the new release being served by another
  issuer than the installed one.
- Full validation re-checks every stored account and group against the new Schema and counts
  every failure; a refusal names them and changes nothing.
- Exit 0 is done or still running. The install waits up to `--timeout`, 110 s without it, for the
  whole install. Still running, the report has no `changed`: follow the Execution it names with
  `astrale execution result <execution> --wait -i "$SLUG" --as "$ROOT" --json` until it completes.
- **Verify:** `expected` and `installed` both equal `$DIGEST`, and `domain list` (above) answers
  `version: <version>` with `pin.release` equal to `$DIGEST`: the registry names that exact
  release.

## Migrate View access

Run it right after the install: until then, a person given a View only through the Shell's Edge
does not open it.

```sh
astrale call /:shell.astrale.ai:function.legacyMigrateViewAccess -d '{}' --json \
  -i "$SLUG" --as "$ROOT" </dev/null
```

- Admitted to `workspace.admin` and Root. It answers `{ copied, removed }`: Kernel Edges created,
  Shell Edges deleted. A pair the Kernel already gives is removed and not copied: `copied` may be
  below `removed`.
- Batches of 200 Edges, each copying and deleting in one write, so a View is never given by
  neither Edge. A failed batch stops the call with `view_access migration stopped after <n> Edges:
  <code>; run it again.`; a later run moves what is left and answers `copied: 0, removed: 0` once
  nothing is.
- **Verify:** no Shell Edge is left, and the Kernel gives every pair the Shell gave:

```sh
pages "$PAIRS" --file view-access.shell.astrale.ai.json | wc -l              # 0
pages "$PAIRS" --file view-access.kernel.astrale.ai.json | sort > after/view-access.tsv
comm -23 before/view-access.tsv after/view-access.tsv                        # empty
```

The pairs are `(identity, View)`: the Edge goes from an account, a group or a Role to the View. One
View's holders: `astrale query @<view> --edge /:kernel.astrale.ai:class.view_access --direction
incoming -i "$SLUG" --as "$ROOT"`.

## Migrate the accounts

Read the [claimed emails](#the-claimed-emails) and the [duplicate people](#duplicate-people) first.

```sh
until
  if astrale call /:shell.astrale.ai:function.legacyMigrateAccounts -d '{}' --json \
      -i "$SLUG" --as "$ROOT" </dev/null > after/migrate.json 2> after/migrate.err; then
    jq -c '{migrated, profiles, conflicts: (.conflicts | length)}' after/migrate.json
    jq -e '.migrated == 0 and .profiles == 0' after/migrate.json > /dev/null
  elif grep -q '"code":4005' after/migrate.err; then
    echo 'invocation deadline reached; calling again'; false
  else
    cat after/migrate.err >&2; true
  fi
do :; done
```

- Admitted to `workspace.admin` and Root. It answers `{ migrated, conflicts, profiles }`, each of
  this call only: the accounts it gave an `email` or a `name`, the accounts whose claimed email
  another account holds, and the profiles it created for accounts and groups that had none.
- An account with no `claimedEmail`, or one that is not an email, gets no `email` and is not a
  conflict. A conflict gets neither `email` nor `name`.
- It is an Action: on a large instance a call stops at the invocation deadline (about 25 s, code
  4005, exit 1) and reports nothing; the work done before stays written. The loop calls again
  until a call answers `migrated: 0` and `profiles: 0`; that last call still reads every account,
  and its `conflicts` lists every conflict left. Any other failure stops the loop with its error.
- **Verify** with state counts, not the answers:

```sh
pages '.graph.nodes[]' --class /:shell.astrale.ai:class.User > after/users.jsonl
pages '.graph.nodes[].id' --class /:shell.astrale.ai:class.UserProfile | wc -l    # = accounts
pages '.graph.nodes[].id' --class /:shell.astrale.ai:class.GroupProfile | wc -l   # = named groups
jq -s '{accounts: length,
  email: map(select(.props["shell.astrale.ai:class.User.property.email"])) | length,
  unnamed: map(select((.props["shell.astrale.ai:class.User.property.name"] // .props["shell.astrale.ai:class.User.property.email"]) == null)) | length}' \
  after/users.jsonl
jq -s '[.[] | select(.props["kernel.astrale.ai:class.Named.property.name"])] | length' before/groups.jsonl
```

A profile the migration cannot create is not counted and not reported: a count below the accounts
or the named groups names the gap; the next call retries it.

### Conflicts and unnamed accounts

Each conflict `{ user, email }` names an account (`user`, a Path `@<id>`) whose claimed email
another account holds. Decide which account the person signs in to:

- the holder: give the conflicting account a name of its own, and an email if it has one;
- the conflicting account: change the holder's email first, then run the migration again, which
  writes the claimed email and name there.

An administrator (`user.writer`) or Root writes an account with `User.update`, which renames its
profile with it:

```sh
astrale call "@<id>::shell.astrale.ai:class.User.method.update" name="Ada Martin" \
  -i "$SLUG" --as "$ROOT" </dev/null
astrale call "@<id>::shell.astrale.ai:class.User.method.update" email=ada.martin@example.com \
  -i "$SLUG" --as "$ROOT" </dev/null
```

An account left with neither name nor email has a profile named `Compte sans nom` until it is
renamed this way; list them with
`jq -r 'select((.props["shell.astrale.ai:class.User.property.name"] // .props["shell.astrale.ai:class.User.property.email"]) == null) | .id' after/users.jsonl`.
`User.update` refuses an email another account holds (`USER_EMAIL_TAKEN`), and the name or email of
an account a directory provides (`USER_DIRECTORY_MANAGED`): that directory renames it.

## Verify

The accounts, the groups and the memberships are unchanged:

```sh
pages '.graph.nodes[]' --class /:shell.astrale.ai:class.Group > after/groups.jsonl
mkdir -p after/members
for id in $(jq -r .id before/groups.jsonl); do
  pages '.graph.nodes[].id' "@$id" --edge /:kernel.astrale.ai:class.extends_with \
    --direction incoming | sort > "after/members/$id"
done
for kind in users groups; do
  diff <(jq -r .id "before/$kind.jsonl" | sort) <(jq -r .id "after/$kind.jsonl" | sort)
done
diff -r before/members after/members
```

(`diff <(…)` needs bash or zsh; in a plain POSIX shell, write both sides to files first.)

### Per person

Root's success proves nothing about a person's access. Root holds `identity.impersonator`, the Kernel
Role no bundle includes: `Identity.impersonate` gives it a short-lived credential bounded by one
person's account, under which every call is decided as that person; issuing it writes no Node or
Edge. Pick an account that is a member of each of the four Core groups, and decide its Roles as it:

```sh
PERSON=$(astrale call /:kernel.astrale.ai:class.Identity:impersonate \
  -d '{"identity":"<account-id>","ttlSeconds":120}' --raw -i "$SLUG" --as "$ROOT" </dev/null)
astrale call /:kernel.astrale.ai:class.Identity:can --json -i "$SLUG" --creds "$PERSON" -d '{"checks":[
  {"policy":"/:kernel.astrale.ai:policy.hasRole","object":"/:shell.astrale.ai:core.workspace.admin"},
  {"policy":"/:kernel.astrale.ai:policy.hasRole","object":"/:shell.astrale.ai:core.workspace.member"},
  {"policy":"/:kernel.astrale.ai:policy.hasRole","object":"/:kernel.astrale.ai:core.reader"}]}' \
  </dev/null | jq -c '[.decisions[].allowed]'
```

`<account-id>` is a bare id from `before/members/<id>`, with `<id>` from `before/core-groups`. The
credential lasts `ttlSeconds`, never beyond the credential that asked for it: impersonate again when
it expires. Never print it.

| Member of | Decisions | A call it is refused, as `--creds "$PERSON"` |
| --- | --- | --- |
| "Administrators" | `[true,true,true]` | `call /:kernel.astrale.ai:class.Identity:impersonate -d '{"identity":"<any id>","ttlSeconds":60}'`: `identity.impersonator` is in no bundle |
| "Members" | `[false,true,true]` | `call "@<its own id>::shell.astrale.ai:class.User.method.update" -d '{}'`: `User.update` needs `user.writer`; an administrator gets `{}` and nothing is written |
| "Applications", "View only" | `[false,false,true]` | `query --class /:shell.astrale.ai:class.UserProfile --limit 2` answers at most its own profile, where a member reads every profile (`user-profile.reader`) |

Run each refused call with `-i "$SLUG" --creds "$PERSON" </dev/null`, and one administrator task
through the Shell methods as an administrator.

## Roll back

Reinstalling the previous Shell is not a rollback here. An install of an earlier release must fit
the data as it is now: the previous Shell declares neither `email`, `name`, `UserProfile` and
`GroupProfile` nor the Role Core nodes the install created, so its install is refused
(`DATA_MIGRATION_REQUIRED`). No install brings back what the migrations wrote over or deleted,
such as the Shell `view_access` Edges.

The rollback is a restore of the Host, by its operator. Give them `before/instance.json` (the
instance's slug, `id` and `hostId`) and `before/instant`, and ask for the Host's newest recovery
point at or before that instant. A restore rebuilds the whole Host on a new machine: the Host leaves
service while it runs, every instance it holds returns to that point and loses every change made
after it, and a person confirms it before the Host returns to service.

After the restore, verify: `domain list` (above) answers the previous version, and the baseline reads
(accounts, groups, `before/members`, `before/view-access.tsv`) give the same results as in
`before/`.
