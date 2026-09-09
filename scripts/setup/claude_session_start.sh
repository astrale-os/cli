#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# Local sessions only load paths prepared by an explicit setup.
if [[ "${CLAUDE_CODE_REMOTE:-}" == true ]]; then
  agent_load_config
  export AGENT_HARNESSES=claude AGENT_SETUP_TOOLS=install
  command -v flock >/dev/null 2>&1 || agent_die 'Claude Cloud initialization requires flock (util-linux)'
  state="$AGENT_SETUP_HOME/state/claude"
  mkdir -p "$state"
  # Scope to the physical checkout, never to its branch, HEAD or Claude session id.
  if command -v sha256sum >/dev/null 2>&1; then
    key="$(printf '%s\0' "$AGENT_REPO_ROOT" | sha256sum | cut -d ' ' -f 1)"
  else
    key="$(printf '%s\0' "$AGENT_REPO_ROOT" | shasum -a 256 | cut -d ' ' -f 1)"
  fi
  (
    # The OS releases this lock on exit, including interruption; no stale PID lock to repair.
    flock -x -w 600 9 || agent_die 'Timed out waiting for the Claude setup lock'
    marker="$state/$key.ready"
    if [[ -f "$marker" ]] && [[ "$(cat "$marker")" == ready ]]; then
      agent_log 'Claude checkout already initialized; loading environment only' >&2
    else
      bash "$SCRIPT_DIR/setup.sh" >&2
      bash "$SCRIPT_DIR/verify.sh" >&2
      [[ -r "$AGENT_ENV_FILE" ]] || agent_die 'Setup did not create its shell environment'
      temporary="$(mktemp "$state/$key.XXXXXX")"
      trap 'rm -f "$temporary"' EXIT
      printf 'ready\n' > "$temporary"
      mv "$temporary" "$marker"
      printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}\n'
    fi
    [[ -r "$AGENT_ENV_FILE" ]] || agent_die 'Prepared environment is missing; run setup.sh explicitly to repair it'
  ) 9> "$state/$key.lock"
fi
# SessionStart's environment file also covers non-login Bash commands, which do not read profiles.
# An installing setup already referenced env.sh here; inlining it again would restack the same PATH.
if [[ -f "$AGENT_ENV_FILE" && -n "${CLAUDE_ENV_FILE:-}" ]] &&
  ! grep -Fqx "$(agent_environment_reference)" "$CLAUDE_ENV_FILE" 2>/dev/null; then
  cat "$AGENT_ENV_FILE" >> "$CLAUDE_ENV_FILE"
fi
