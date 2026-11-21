# Legacy ledger — `astrale-domain` skill references

Guides for Domains and instances that still run a previous model, and for moving them across a
breaking change, by the method of [`docs/legacy.md`](../../../../docs/legacy.md) in the CLI
repository. Find the row whose legacy item names what the code or instance still uses, and follow
its guide; paths are relative to `references/`. Removing an item deletes its file, its row and the
one link its seam holds; nothing else in the skill changes.

| id | legacy item (file) | replaced by | seam | removal condition | evidence (test) |
| --- | --- | --- | --- | --- | --- |
| L-CLI-1 | The Users and groups guide of the subclass model: Domains extending `Shell.User`/`Shell.Group`, the `ownsUserOrGroupClass` traversal Policy, `member_of_group`, `User.invite({ user, email })`, `Group.assignMember` to the Core groups "Administrators" and "Members", registration onto an existing node (`legacy/users.md`) | The accounts reference: business record and `holds_account`, Domain `Role` and `hasRole`, Teams, release `roles`/`scopes`, `S.User.create`, `S.Invitation.send` (`references/users.md`) | The "Migrating from the subclass model" section of `references/users.md`, its only link | The Shell major release that makes `User` and `Group` final and deletes its legacy layer | `scripts/domain-skill.test.mjs` › "legacy guides are deprecated, ledgered and reached only from their target's migration section" |
| L-CLI-2 | The operator upgrade of an instance from a Shell before Roles: install under Root, `legacyMigrateAccounts`, `legacyMigrateViewAccess`, verification and rollback (`legacy/shell-roles-upgrade.md`) | Nothing: an instance created on a Shell with Roles needs no upgrade; the result is described by the accounts reference (`references/users.md`) | The "Migrating from the subclass model" section of `references/users.md`, its only link | The Shell major release that removes `legacyMigrateAccounts` and `legacyMigrateViewAccess` | `scripts/domain-skill.test.mjs` › "legacy guides are deprecated, ledgered and reached only from their target's migration section" |
