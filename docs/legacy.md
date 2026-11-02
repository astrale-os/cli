# Legacy: keeping old behaviour without letting it spread

A change of design rarely lands everywhere at once: installed Domains, instances on older releases
and readers following an older guide keep the previous model. This method keeps what they still need
in one place, named, ledgered and ready to delete, while every other page and file reads as the new
design. The Astrale repositories share it; this page adapts the SDK's
[`docs/legacy.md`](https://github.com/astrale-os/sdk/blob/main/docs/legacy.md) to the CLI, whose
legacy so far is documentation shipped in its skills.

The aim is that removing the old behaviour later is a deletion: delete each legacy file, the one
link or call that reaches it and its ledger row, and nothing else changes.

## The rules

1. **Target content is the only content outside `legacy/`.** Every skill page, example and source
   file outside a `legacy/` folder shows only the target design and API. A legacy guide lives in a
   `legacy/` folder next to the page it was replaced by (`skills/astrale-domain/references/legacy/`),
   under the name it had (`legacy/users.md`), never in a repository-wide dumping ground. Legacy
   code, if the CLI ever keeps some, follows the same placement next to its owner in `src/`.
2. **Legacy is named.** A legacy guide's title ends with the model it describes and `(deprecated)`.
   Every exported legacy symbol starts with `legacy`, or `Legacy` for a type or class.
3. **Legacy is tagged.** A legacy guide opens with one banner:
   `> **Deprecated (<ledger id>).** <what it describes>. **Replaced by** <target page>. **Removal:** <condition>.`
   A legacy code export carries
   `@deprecated <what it keeps> (<ledger id>). Replaced by <target symbol>. Removal: <condition>.`
4. **One seam per owner.** A legacy guide is reached by exactly one link: the "Migrating from …"
   section of the page that replaced it, which maps old names to new ones. A skill's router
   (`SKILL.md`) and every other page link only target pages. For code, target code reaches legacy
   code through one explicit, named call per owner.
5. **Ledger.** Each skill with legacy guides keeps `references/legacy/LEDGER.md`; code keeps
   `legacy/LEDGER.md` at the repository root. One row per item:

   `| id | legacy item (file) | replaced by | seam | removal condition | evidence (test) |`

   Ids are `L-CLI-<n>`, shared by both ledgers and never reused.
6. **Evidence.** A test proves each rule: `scripts/domain-skill.test.mjs` fails when a legacy guide
   has no banner or no ledger row, when it is linked from anywhere but its seam, or when a target page
   uses a name of the legacy model outside its migration section. A legacy code item also has a test
   under `legacy/__tests__/` proving the old behaviour still works.
7. **No new legacy consumers.** Examples, scaffolds and answers follow the target page. A remaining
   consumer that cannot move yet is listed under its ledger table, with the reason.

## Adding a legacy item

1. Write the target page first, as if the old model never existed, with a short "Migrating from …"
   section that maps old names to new ones.
2. Move the old page to `legacy/` next to the target page, retitle it and add its banner.
3. Link it once, from the migration section. Remove every other link to it.
4. Add the ledger row and run `node --test scripts/domain-skill.test.mjs` (or `pnpm test`).

## Removing a legacy item

When its removal condition holds: delete the legacy file, the link in its seam and its row. If
anything else has to change, the item was not fully isolated: record that in the ledger first.

## In this repository

[`skills/astrale-domain/references/legacy/LEDGER.md`](../skills/astrale-domain/references/legacy/LEDGER.md)
lists the items. L-CLI-1 keeps the guide of the Shell subclass model (Domains extending Shell `User`
and `Group`, `member_of_group`, Core groups) until the Shell major release that makes `User` and
`Group` final (delivery step 5 of the accounts, groups and Roles design).
