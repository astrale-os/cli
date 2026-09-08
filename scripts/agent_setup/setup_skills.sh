#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

agent_load_config
agent_resolve_harnesses
if [[ "$AGENT_SETUP_BROWSER" == 0 ]]; then
  agent_log 'Browser skills disabled by repository configuration'
  exit 0
fi
if [[ -z "$AGENT_HARNESSES" ]]; then
  agent_log 'No harness selected; skipping browser skills'
  exit 0
fi
agent_ensure_node
for harness in ${AGENT_HARNESSES//,/ }; do
  agent_ensure_skill "$harness" vercel-labs/agent-browser agent-browser
  agent_ensure_skill "$harness" ChromeDevTools/chrome-devtools-mcp chrome-devtools-cli
done
