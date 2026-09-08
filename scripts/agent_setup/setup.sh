#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

agent_load_config
agent_resolve_harnesses
# Each consumer owns its Git preconditions, including when called directly.
bash "$SCRIPT_DIR/setup_repo.sh" --check
bash "$SCRIPT_DIR/setup_runtimes.sh"
bash "$SCRIPT_DIR/setup_browser_tools.sh"
bash "$SCRIPT_DIR/setup_skills.sh"
bash "$SCRIPT_DIR/setup_repo.sh"
agent_log "Setup complete (harnesses: ${AGENT_HARNESSES:-none})"
