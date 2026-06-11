# Changelog

## 0.4.0-alpha.9 (2026-06-11)

### Public Alpha

* durable IdP sessions: one login lasts until the IdP ends the session — refreshes serialize on a per-identity file lock, so parallel (agent-driven) commands no longer burn the single-use refresh token
* cache access tokens per audience: alternating commands between instances no longer triggers a refresh per flip (~2x faster on mixed-instance workflows)
* tell transient IdP/network failures apart from a dead grant — only the latter asks for `astrale auth login`
* lazy whoami-backed `@self` for IdP identities
* saga-sized default timeout on `instance create`/`instance delete`

## 0.4.0-alpha.8 (2026-06-08)

### Public Alpha

* publish deterministic standalone builds from CI
* track channel release identity so `astrale update --check` is accurate
* publish current kernel package contracts in the CLI lockfile

## 0.4.0-alpha.7 (2026-06-08)

### Public Alpha

* make WorkOS device login work on fresh script installs without env setup

## 0.4.0-alpha.6 (2026-06-08)

### Public Alpha

* point fresh `instance create` users at `astrale auth login`

## 0.4.0-alpha.5 (2026-06-08)

### Public Alpha

* build Linux release assets with musl targets for Alpine-based sandboxes
* document the `wget` installer path for minimal Linux images

## 0.4.0-alpha.4 (2026-06-08)

### Public Alpha

* add script-only alpha installer and GitHub Releases binary workflow
* add `astrale update` for script-installed CLI binaries
* make `astrale instance create` call admin `Instance.alphaCreate`
* fix standalone `--version` output and exit behavior
