#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/browser.sh"

agent_load_config
agent_resolve_harnesses
if [[ "$AGENT_SETUP_BROWSER" == 0 ]]; then
  agent_log 'Browser tools disabled by repository configuration'
  exit 0
fi
if [[ "$AGENT_SETUP_TOOLS" == check ]]; then
  agent_ensure_node
  for tool in playwright agent-browser chrome-devtools; do agent_ensure_cli "$tool" "$tool"; done
  agent_select_browser
  for tool in playwright agent-browser chrome-devtools; do
    agent_check_browser "$tool" || agent_die "Prepare a working browser for $tool locally, then rerun setup"
  done
  exit 0
fi
agent_bootstrap_system
agent_ensure_node
# Common: the diagnostic calls this exact preparation function too. Claude Cloud reuses a
# healthy preinstalled pair; the Codex Cloud APT policy applies only when libraries are missing.
agent_ensure_browser
agent_ensure_cli agent-browser agent-browser
agent_ensure_cli chrome-devtools chrome-devtools-mcp
if ! agent_check_browser agent-browser; then
  agent_npm_install "$AGENT_TOOLS" agent-browser@latest
  agent_link "$AGENT_TOOLS/bin/agent-browser" agent-browser
  agent_check_browser agent-browser
fi
if ! agent_check_browser chrome-devtools; then
  agent_npm_install "$AGENT_TOOLS" chrome-devtools-mcp@latest
  agent_link "$AGENT_TOOLS/bin/chrome-devtools" chrome-devtools
  agent_check_browser chrome-devtools
fi
agent_persist_environment
