#!/usr/bin/env bash
# CLI-owned requirements; shared runtime setup remains unchanged.
cli_bun_version() {
  local version
  [[ -f "$AGENT_REPO_ROOT/.bun-version" ]] || agent_die 'Missing .bun-version'
  version="$(tr -d '[:space:]' < "$AGENT_REPO_ROOT/.bun-version")"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || agent_die '.bun-version must declare an exact Bun version'
  printf '%s\n' "$version"
}
cli_check_repo() {
  local file
  for file in pnpm-workspace.yaml studio/package.json studio/e2e/fixture/package.json studio/e2e/fixture/peer/package.json scripts/build-embedded-assets.ts; do
    [[ -f "$AGENT_REPO_ROOT/$file" ]] || agent_die "Incomplete CLI checkout: missing $file"
  done
  cli_bun_version >/dev/null
}
cli_ensure_bun() {
  local version prefix
  version="$(cli_bun_version)"
  if [[ "$AGENT_SETUP_TOOLS" == check ]]; then
    [[ "$(bun --version 2>/dev/null || true)" == "$version" ]] || agent_die "Activate Bun $version on your machine, then rerun setup"
    return
  fi
  if [[ "$(bun --version 2>/dev/null || true)" != "$version" ]]; then
    prefix="$AGENT_SETUP_HOME/cli-bun/$version"
    if [[ "$("$prefix/bin/bun" --version 2>/dev/null || true)" != "$version" ]]; then
      agent_log "Installing CLI's pinned Bun $version"
      agent_npm_install "$prefix" "bun@$version"
    fi
    agent_link "$prefix/bin/bun" bun
  else
    agent_link "$(command -v bun)" bun
  fi
  [[ "$(bun --version)" == "$version" ]] || agent_die 'Bun does not match .bun-version after installation'
  agent_log "Verified CLI Bun $version"
}
