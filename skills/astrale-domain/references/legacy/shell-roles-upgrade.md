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

Two things are called a profile. The Shell's profile Roles, `workspace.admin` and
`workspace.member`, are Core nodes a person holds by membership (`extends_with`), as Kernel `reader`
is; member ⊂ admin. A profile Node, `UserProfile` or `GroupProfile`, holds the name, email and
picture others see of one account or group, which links to it by a `user_profile` or
`group_profile` Edge. Below, "profile" alone is always the Node; Roles are named.

| Stored before | After the install | After the migrations |
| --- | --- | --- |
| Core group "Administrators" and its members | The group is a member of `workspace.admin`, by release: its members hold it with no data change | Same |
| Core group "Members" | Member of `workspace.member` | Same |
| Core groups "Applications", "View only" | Members of Kernel `reader`, and of no profile Role | Same |
| `member_of_group` | Still written beside `extends_with` when an account joins a legacy Core group, removed when it leaves any group | Same |
| `claimedEmail`, `claimedName` on accounts | Kept; `email`, `name` absent | On the Shell's own `User` and `Group` Nodes: `email`, `name` written where absent; a profile for every account and every named group |
| The Shell's `view_access` Edges | Kept; the Kernel opens a View only through its own `view_access` | Copied to the Kernel's `view_access`, then deleted |

For Domains built against the subclass model, and for administrators:

- **Administrators lose direct Mutations on `User`, `Group` and `member_of_group`.** The Class
  grants the previous release gave the "Administrators" group are revoked by the install; every
  write goes through the Shell methods (`User.create`, `User.update`, `Group.assignMember`, …).
  Find the scripts and tools that mutate these Classes directly before installing.
- **A group of a Domain's `Group` subclass changes members under the caller's own authority.**
  Shell writes its membership as the caller, not as itself: call it through the owner Domain's own
  callable. An administrator calling `Group.assignMember` or `Group.unassignMember` on such a group
  directly is refused `GROUP_DOMAIN_MANAGED` (family CONFLICT). Groups of the Shell's own Class are
  unaffected.
- **A member may be a service account.** `ServiceAccount`, a non-human Identity that signs in with
  a key pair, is a final Class of its own, not a `User`: `Group.assignMember` and
  `Group.unassignMember` accept it as `member`, and `member_of_group` accepts it as source. A reader
  of memberships that expects only `User` and `Group` members meets that Class once a service
  account joins a group; it reads the account only under `service-account.admin` or `user.reader`.
  The account migration neither writes a service account nor gives it a profile.
- **The account migration does not see the accounts and groups of a subclass.** A Query a Domain
  runs reads only the Classes of its own closure, which for the Shell are the Kernel's and its own:
  the migration reads the Shell's own `User` and `Group` Nodes alone. An account or a group of another
  Domain's subclass is neither read, nor written, nor counted, nor reported: it gets no `email`,
  no `name` and no profile, and its claim is not compared with the others (see [Duplicate
  people](#duplicate-people)). [The account profiles](#the-account-profiles) lists them.
- **What an account without a profile lacks.** The profile carries what is read through it: the
  picture, and the name and email a reader of `UserProfile` (`user-profile.reader`, which members
  hold) reads there. The `User` read rule stays open, for the Domains built against the
  earlier Shell, so any identity may read the account itself; but the Shell's own reads, its
  directory's included (a Shell Query over `User`), run under the same closure as the migration.
  The Domain that owns the subclass shows its people from its own reads.
- **The Shell has no way to give a subclass account its profile.** `UserProfile`, `GroupProfile` and
  their Edges declare no write rule: only Shell writes them, and the Domain that owns the subclass
  cannot. The Shell methods that create a missing profile, `User.update` (under `user.writer`) and
  `User.updateProfile` (the holder), first read the account through the same Shell Query, which does
  not see a subclass account: they answer `USER_NOT_FOUND`.
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

# edges <origin> <Edge Class>: a Query document selecting every Edge of one Class, as references.
edges() {
  printf '{"format":"astrale.graph.query","version":"v6","source":{"kind":"edge","terms":[{"kind":"class","class":{"origin":"%s","kind":"class","name":"%s"}}],"bindings":{"source":"n0","edge":"e0","target":"n1"}},"steps":[],"select":{"kind":"edges","binding":"e0","projection":{"edge":"reference","source":"reference","target":"reference"}}}\n' \
    "$1" "$2" > "$1.$2.json"
}
edges shell.astrale.ai view_access; edges kernel.astrale.ai view_access
edges shell.astrale.ai user_profile; edges shell.astrale.ai group_profile
PAIRS='.edges[] | [.source.value.id, .target.value.id] | @tsv'   # (source, target) pairs

# reach <id>: every Node <id> extends, directly or through its groups, as id<TAB>class.
reach() {
  printf '%s\n' "$1" > .reach.next; : > .reach.all
  while [ -s .reach.next ]; do
    while read -r node; do
      pages '.graph.nodes[] | [.id, .class] | @tsv' "@$node" \
        --edge /:kernel.astrale.ai:class.extends_with --direction outgoing
    done < .reach.next | sort -u > .reach.step
    comm -13 .reach.all .reach.step > .reach.new
    sort -u .reach.all .reach.new -o .reach.all
    cut -f1 .reach.new > .reach.next
  done
  cat .reach.all
}
TAB=$(printf '\t')
```

`astrale query --edge` answers the neighbour Nodes of its source, never Edges; the documents
`edges` writes select the Edges themselves, as `{ edge, source, target }` references. An account
holds every Role `reach` lists for it.

### The version and the release

A version reference (`shell.astrale.ai@<version>`) and the VERSION column of `domain list` are read
in the Admin registry under the identity of the command (`--as`, else the default identity). An
instance's Root is not an Admin identity: under `--as "$ROOT"` both are refused
`REGISTRY_FORBIDDEN`. Read the registry under the default identity, and install the release by its
deployment URL:

```sh
# The newest 0.3 version that is neither a pre-release nor yanked: version, url, releaseDigest.
astrale domain versions shell.astrale.ai --json \
  | jq -r '[.publications[] | select((.version | test("^0\\.3\\.[0-9]+$")) and (.yanked | not))][0]
           | [.version, .url, .releaseDigest] | @tsv'
VERSION=<version>; URL=<url>; DIGEST=<releaseDigest>

# The installed Shell: --creds authenticates the instance only; the registry is read as you.
astrale domain list -i "$SLUG" --creds "$(astrale token --raw -i "$SLUG" --as "$ROOT")" --json \
  | jq '.domains[] | select(.origin == "shell.astrale.ai") | {version, name, pin}'
```

The page applies to an installed Shell without Roles (the `0.1` line) and describes the `0.3`
line. The `0.2` line is superseded: its account migration does not stop before the invocation
deadline, so a call over many accounts can be ended with code 4005 before it answers. Publications
are listed highest first; take the newest stable version of the line that is not yanked. No change note is published with a version: neither the registry nor the release carries
one. A Publication names the commit it was built from (`commit`) when its publisher recorded it.

### A recovery point

A restore of the Host is the only rollback ([Roll back](#roll-back)). Confirm with the Host operator
that the Host is backed up, and record the instance a restore names; the instant is recorded at the
install:

```sh
astrale instance status "$SLUG" --json | jq '{slug, id, hostId}' > before/instance.json
# The other instances you see on the same Host (needs an Admin account): a restore rolls them back too.
astrale instance list --admin-only --json \
  | jq --arg host "$(jq -r .hostId before/instance.json)" \
       '[.instances[] | select(.hostId == $host) | {slug, id, state}]'
```

A restore rolls back every instance on the Host, not only this one, and `instance list` shows only
the instances you may read: ask the Host operator which instances the Host holds, and agree on the
restore with their owners before installing.

### A rehearsal

Run the whole page first on an instance holding a representative number of accounts: the number of
calls the account migration takes grows with them ([Migrate the accounts](#migrate-the-accounts)).

### The baseline

```sh
pages '.graph.nodes[]' --class /:shell.astrale.ai:class.User > before/users.jsonl
pages '.graph.nodes[]' --class /:shell.astrale.ai:class.Group > before/groups.jsonl
mkdir -p before/members
for id in $(jq -r .id before/groups.jsonl); do
  pages '.graph.nodes[].id' "@$id" --edge /:kernel.astrale.ai:class.extends_with \
    --direction incoming | sort > "before/members/$id"
done
pages "$PAIRS" --file shell.astrale.ai.view_access.json | sort > before/view-access.tsv
wc -l before/users.jsonl before/groups.jsonl before/view-access.tsv
jq -r .class before/users.jsonl | sort | uniq -c       # accounts by Class
```

The Group extent includes the four Core groups and every group of a Domain's `Group` subclass; each
file of `before/members` lists the accounts and groups that extend one group. The four Core groups'
ids:

```sh
for core in admin member applications view-only; do
  printf '%s %s\n' "$core" "$(pages '.graph.nodes[].id' "/:shell.astrale.ai:core.$core")"
done | tee before/core-groups
```

What a sample of accounts extends, one member of each group, through the groups and Roles of every
Domain:

```sh
jq -r .id before/users.jsonl | sort > before/user-ids
for f in before/members/*; do grep -Fx -f before/user-ids "$f" | head -n 1; done | sort -u > sample
mkdir -p before/reach
while read -r id; do reach "$id" > "before/reach/$id"; done < sample
```

Add to `sample` any account whose access matters, one per line, before reading it.

### The claimed emails

`claimedEmail` and `claimedName` are what each account recorded about itself through
`User.recordProfile`; nothing records whether an identity provider verified them. The GUI records,
at each sign-in, the email and name of the identity provider's session, but any client holding the
account's credential can record any value, whatever issuer the account authenticates with. The
migration makes the claimed email the account's `email`, the key that binds a first sign-in to it.
Check every claim against a source independent of the account, such as the identity provider's
directory, before the migration. List the claims, with the issuer each account authenticates with
(`iss`):

```sh
jq -r '[.id, (.props["kernel.astrale.ai:class.Identity.property.iss"] // "-"),
        (.props["shell.astrale.ai:class.User.property.claimedEmail"] // "-")] | @tsv' \
  before/users.jsonl > before/claims.tsv
```

The migration writes an email only on an account that has none. After the install and before the
migration, write the verified email on every account whose claim differs from it, with `User.update`
([Conflicts and unnamed accounts](#conflicts-and-unnamed-accounts)): the migration then leaves that
account's email as written. Run the migration only once every remaining claim is verified. The
claim of an account of a subclass is listed too, but the migration does not use it.

### Duplicate people

The migration compares a claimed email only with the Shell `email` of the other accounts of the
Shell's Class. An account whose claimed email an account of a `User` subclass holds, under its
Shell `email` or a Property of its own Domain, is not reported: both stay, one person with two
accounts. List such pairs:

```sh
jq -rs '
  def norm: gsub("^\\s+|\\s+$"; "") | ascii_downcase;
  . as $all
  | .[] | select(.props["shell.astrale.ai:class.User.property.claimedEmail"] | type == "string")
  | (.props["shell.astrale.ai:class.User.property.claimedEmail"] | norm) as $email
  | .id as $claimer
  | $all[] | select(.id != $claimer and .class != "shell.astrale.ai:class.User") | . as $other
  | .props | to_entries[]
  | select((.key | startswith("kernel.astrale.ai:") or test("\\.property\\.claimed")) | not)
  | select((.value | type) == "string" and (.value | norm) == $email)
  | [$claimer, $other.id, $other.class, .key, $email] | @tsv' before/users.jsonl
```

The migration can proceed: a claiming account of the Shell's Class gets the email, unless another
account of that Class holds it (a conflict), and the account of the subclass is untouched. The
result is one person with two accounts, one in each model. The Domain that owns the subclass decides which one the person keeps, through its
own callables, before or after the migration.

## Install

```sh
date -u +%Y-%m-%dT%H:%M:%SZ > before/instant      # the recovery point a restore goes back to
astrale domain install "$URL" -i "$SLUG" --as "$ROOT" \
  --allow-issuer-change=shell.astrale.ai \
  --validation-scope full --validation-counts exact --json </dev/null > after/install.json
jq '{changed, execution, follow}' after/install.json
```

- `--allow-issuer-change=shell.astrale.ai` consents to the new release being served by another
  issuer than the installed one.
- Full validation re-checks every stored account and group against the new Schema and counts
  every failure; a refusal names them and changes nothing.
- Exit 0 is done or still running. `--timeout` bounds the install request and its wait together,
  110000 ms without it. Still running, the report has no `changed` and its `references` are empty:
  follow the Execution it names until it ends (exit 75: not ended yet, read again):

```sh
EXECUTION=$(jq -r '.execution // empty' after/install.json)
while [ -n "$EXECUTION" ]; do
  astrale execution result "$EXECUTION" --wait -i "$SLUG" --as "$ROOT" --json \
    </dev/null > after/install-result.json
  [ $? -eq 75 ] || break
done
```

- **Verify**, once the install has ended: `domain list` (above) answers `version: <version>` with
  `pin.release` equal to `$DIGEST`, the release the registry names.

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
pages "$PAIRS" --file shell.astrale.ai.view_access.json | wc -l              # 0
pages "$PAIRS" --file kernel.astrale.ai.view_access.json | sort > after/view-access.tsv
comm -23 before/view-access.tsv after/view-access.tsv                        # empty
```

The pairs are `(identity, View)`: the Edge goes from an account, a group or a Role to the View. One
View's holders: `astrale query @<view> --edge /:kernel.astrale.ai:class.view_access --direction
incoming -i "$SLUG" --as "$ROOT"`.

## Migrate the accounts

Verify the [claimed emails](#the-claimed-emails) and read the [duplicate people](#duplicate-people) first.

- Admitted to `workspace.admin` and Root. It answers
  `{ migrated, conflicts, profiles, unprofiled, remaining }`. The first four are of this call only:
  the accounts it gave an `email` or a `name`; the accounts whose claimed email another account, or
  another account's profile, holds; the profiles it created for accounts and groups that had none;
  the accounts and groups whose profile the Kernel refused and that still have none, each
  `{ node, reason, rule? }`. `remaining` counts the accounts and groups left for the next call.
- An account with no `claimedEmail`, or one that is not an email, gets no `email` and is not a
  conflict. A conflict gets neither `email` nor `name`, and still gets a profile if it has none.
- One call reads the accounts, the groups and the profiles with their emails in three Queries, then
  works only on the accounts and groups left, one of each in turn. Each Query reads at most 103
  pages of 1,000; past that, the call is refused `QUERY_PAGINATION_LIMIT` and writes nothing. It starts none within 5 s of the
  invocation deadline and answers; the first always runs. A write a concurrent change refused is
  counted in `remaining` and read again by the next call. Every completed write stays, whole.
- The migration is complete when a call answers `remaining: 0` and an empty `unprofiled`; that
  call's `conflicts` lists every conflict left. Running it again then changes nothing.

Count the progress between calls: the accounts with an email and with a name, the account profiles
and the group profiles.

```sh
progress() {
  accounts=$(pages '.graph.nodes[].props | [has("shell.astrale.ai:class.User.property.email"), has("shell.astrale.ai:class.User.property.name")] | map(if . then 1 else 0 end) | @tsv' \
    --class /:shell.astrale.ai:class.User | awk '{ e += $1; n += $2 } END { print e + 0, n + 0 }')
  users=$(pages '.graph.nodes[].id' --class /:shell.astrale.ai:class.UserProfile | wc -l)
  groups=$(pages '.graph.nodes[].id' --class /:shell.astrale.ai:class.GroupProfile | wc -l)
  echo $accounts $users $groups     # emails, names, account profiles, group profiles
}
progress > after/progress
last=
while :; do
  if astrale call /:shell.astrale.ai:function.legacyMigrateAccounts -d '{}' --json \
      -i "$SLUG" --as "$ROOT" </dev/null > after/migrate.json 2> after/migrate.err; then
    jq -c '{migrated, profiles, conflicts: (.conflicts | length), unprofiled: (.unprofiled | length), remaining}' \
      after/migrate.json
    progress >> after/progress
    now=$(jq '.remaining' after/migrate.json)
    [ "$now" -eq 0 ] && break
    [ -z "$last" ] || [ "$now" -lt "$last" ] || { echo 'remaining did not decrease: stop and report' >&2; break; }
    last=$now
  elif grep -q '"code":4005' after/migrate.err; then
    before=$(tail -n 1 after/progress); now=$(progress); echo "$now" >> after/progress
    echo "deadline reached: $before -> $now"
    [ "$now" != "$before" ] || { echo 'no progress: stop and report' >&2; break; }
  else
    cat after/migrate.err >&2; break
  fi
done
jq '{unprofiled, conflicts}' after/migrate.json
```

- Each call lowers `remaining`. The loop ends at `remaining: 0`; read `unprofiled` and `conflicts`
  from that last answer.
- **A call that does not lower `remaining` is a stop.** Do not call again; report the instance, its
  number of accounts by Class (from the baseline), `after/progress` and the last answer to the
  Shell's maintainers.
- A call the Kernel ends at the deadline (code 4005, exit 1) answers nothing, and the writes it
  completed stay. Since each call stops before its deadline, this is a fallback: the loop compares
  the counts instead, and a call that raises none is a stop as above.
- `unprofiled` is not counted in `remaining`: each next call is refused alike until what refused it
  changes. `reason: "MUTATION_POST_STATE_INVALID"` with `rule: "duplicate-key"` means the profile
  would carry an email another account's profile holds; it is found from the read, without a
  write. Settle it as a conflict ([Conflicts and unnamed accounts](#conflicts-and-unnamed-accounts)),
  then run the loop again. Report any other reason with its `node`.
- Any other failure stops the loop with its error.

### The account profiles

Read who holds which profile, and the accounts and named groups left without one:

```sh
pages '.graph.nodes[]' --class /:shell.astrale.ai:class.User > after/users.jsonl
pages "$PAIRS" --file shell.astrale.ai.user_profile.json | sort > after/user-profiles.tsv
pages "$PAIRS" --file shell.astrale.ai.group_profile.json | sort > after/group-profiles.tsv
cut -f1 after/user-profiles.tsv | sort > after/users-with-profile
cut -f1 after/group-profiles.tsv | sort > after/groups-with-profile
jq -r '[.id, .class] | @tsv' after/users.jsonl | sort -t "$TAB" -k1,1 \
  | join -t "$TAB" -v 1 - after/users-with-profile > after/users-without-profile
pages '.graph.nodes[] | select(.props["kernel.astrale.ai:class.Named.property.name"]) | [.id, .class] | @tsv' \
  --class /:shell.astrale.ai:class.Group | sort -t "$TAB" -k1,1 \
  | join -t "$TAB" -v 1 - after/groups-with-profile > after/groups-without-profile
cut -f2 after/users-without-profile after/groups-without-profile | sort | uniq -c   # by Class
jq -s '{accounts: length,
  email: map(select(.props["shell.astrale.ai:class.User.property.email"])) | length,
  unnamed: map(select((.props["shell.astrale.ai:class.User.property.name"] // .props["shell.astrale.ai:class.User.property.email"]) == null)) | length}' \
  after/users.jsonl
```

Each line of `after/user-profiles.tsv` pairs an account with its profile, and of
`after/group-profiles.tsv` a group with its profile. The accounts and groups left without one are
those of a subclass, which the migration does not see ([What changes](#what-changes)), and those the
last call answered in `unprofiled`. Any other one of the Shell's own Class left without one is a gap
the next call retries.

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

Root's success proves nothing about a person's access. Two reads show it: what each account of the
sample extends, under Root, for any account; and the decisions of the Kernel under one person's own
credential, for an account that has signed in.

**Memberships.** The Role Core nodes the release added, then what each account of the
[sample](#the-baseline) extends now:

```sh
for role in shell.astrale.ai:core.workspace.admin shell.astrale.ai:core.workspace.member \
    kernel.astrale.ai:core.admin kernel.astrale.ai:core.reader; do
  printf '%s\t%s\n' "$(pages '.graph.nodes[].id' "/:$role")" "$role"
done | sort -t "$TAB" -k1,1 > after/roles
mkdir -p after/reach
while read -r id; do
  reach "$id" > "after/reach/$id"
  echo "$id lost: $(comm -23 "before/reach/$id" "after/reach/$id" | wc -l)"
  sort -t "$TAB" -k1,1 "after/reach/$id" | join -t "$TAB" after/roles - | cut -f2 | sed 's/^/  holds /'
done < sample
```

- `lost: 0` for every account: each group and Role it extended before, of the Shell or of a Domain
  that owns a subclass, it still extends. The lines `comm -13 before/reach/<id> after/reach/<id>`
  prints are what the install added: Role Core nodes of the Shell and of the Kernel only.
- `holds`: a member of "Administrators" holds `workspace.admin`, `workspace.member` and Kernel
  `admin`; of "Members", `workspace.member`; of "Applications" or "View only", Kernel `reader`.
- The read lists memberships and decides no Policy: a decision is the Kernel's, below.

**Decisions.** Root holds `identity.impersonator`, the Kernel Role no bundle includes:
`Identity.impersonate` gives it a short-lived credential bounded by one person's account, under
which every call is decided as that person; issuing it writes no Node or Edge. It names only an
account that holds a registered issuer and subject (`iss` and `sub`: it has signed in once); any
other is refused `IDENTITY_NOT_FOUND` (code 1003). `Identity.can` decides for the caller's own
credential only, and takes no other subject. The accounts it applies to:

```sh
jq -r 'select(.props["kernel.astrale.ai:class.Identity.property.iss"] and .props["kernel.astrale.ai:class.Identity.property.sub"]) | .id' \
  after/users.jsonl
```

Pick one that is a member of each of the four Core groups, where there is one, and decide its Roles
as it:

```sh
PERSON=$(astrale call /:kernel.astrale.ai:class.Identity:impersonate \
  -d '{"identity":"<account-id>","ttlSeconds":120}' --raw -i "$SLUG" --as "$ROOT" </dev/null)
astrale call /:kernel.astrale.ai:class.Identity:can --json -i "$SLUG" --creds "$PERSON" -d '{"checks":[
  {"policy":"/:kernel.astrale.ai:policy.hasRole","object":"/:shell.astrale.ai:core.workspace.admin"},
  {"policy":"/:kernel.astrale.ai:policy.hasRole","object":"/:shell.astrale.ai:core.workspace.member"},
  {"policy":"/:kernel.astrale.ai:policy.hasRole","object":"/:kernel.astrale.ai:core.reader"}]}' \
  </dev/null | jq -c '[.decisions[].allowed]'
```

`<account-id>` is a bare id from that list that is also in `before/members/<id>`, with `<id>` from
`before/core-groups`. Add one check per Role of a Domain that owns a subclass that the person should
hold, `{"policy":"/:kernel.astrale.ai:policy.hasRole","object":"/:<origin>:core.<role>"}`. The
credential lasts `ttlSeconds`, never beyond the credential that asked for it: impersonate again
when it expires. Never print it.

| Member of | Decisions | A call it is refused, as `--creds "$PERSON"` |
| --- | --- | --- |
| "Administrators" | `[true,true,true]` | `call /:kernel.astrale.ai:class.Identity:impersonate -d '{"identity":"<any id>","ttlSeconds":60}'`: `identity.impersonator` is in no bundle |
| "Members" | `[false,true,true]` | `call "@<its own id>::shell.astrale.ai:class.User.method.update" -d '{}'`: `User.update` needs `user.writer`; an administrator gets `{}` and nothing is written |
| "Applications", "View only" | `[false,false,true]` | `query --class /:shell.astrale.ai:class.UserProfile --limit 2` answers at most its own profile, where a member reads every profile (`user-profile.reader`) |

Run each refused call with `-i "$SLUG" --creds "$PERSON" </dev/null`, and one administrator task
through the Shell methods as an administrator. A Core group with no signed-in member is checked by
its memberships alone.

## Roll back

Reinstalling the previous Shell is not a rollback here. An install of an earlier release must fit
the data as it is now: the previous Shell declares neither `email`, `name`, `UserProfile` and
`GroupProfile` nor the Role Core nodes the install created, so its install is refused
(`DATA_MIGRATION_REQUIRED`). No install brings back what the migrations wrote over or deleted,
such as the Shell `view_access` Edges.

The rollback is a restore of the Host, by its operator. Give them `before/instance.json` (the
instance's slug, `id` and `hostId`) and `before/instant`, and ask for the Host's newest recovery
point at or before that instant. A restore rebuilds the whole Host on a new machine: the Host leaves
service while it runs, every instance it holds ([A recovery point](#a-recovery-point)) returns to
that point and loses every change made after it, and a person confirms it before the Host returns to service.

After the restore, verify: `domain list` (above) answers the previous version, and the baseline reads
(accounts, groups, `before/members`, `before/view-access.tsv`) give the same results as in
`before/`.
