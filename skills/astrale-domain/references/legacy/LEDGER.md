# Legacy ledger — `astrale-domain` skill references

Guides kept for Domains and instances that still run a previous model, by the method of
[`docs/legacy.md`](../../../../docs/legacy.md) in the CLI repository. Removing an item deletes its
file, its row and the one link its seam holds; nothing else in the skill changes.

| id | legacy item (file) | replaced by | seam | removal condition | evidence (test) |
| --- | --- | --- | --- | --- | --- |
| L-CLI-1 | The Users and groups guide of the subclass model: Domains extending `Shell.User`/`Shell.Group`, the `ownsUserOrGroupClass` traversal Policy, `member_of_group`, `User.invite({ user, email })`, `Group.assignMember` to the Core groups "Administrators" and "Members", registration onto an existing node (`legacy/users.md`) | The accounts reference: business record and `holds_account`, Domain `Role` and `hasRole`, Teams, release `roles`/`scopes`, `S.User.create`/`invite` (`references/users.md`) | The "Migrating from the subclass model" section of `references/users.md`, its only link | Shell major (delivery step 5): `User` and `Group` final and Shell `legacy/` deleted, after 1Pact has moved (delivery step 4) | `scripts/domain-skill.test.mjs` › "legacy guides are deprecated, ledgered and reached only from their target's migration section" |
