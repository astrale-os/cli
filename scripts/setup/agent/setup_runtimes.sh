#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

agent_load_config
agent_resolve_harnesses
agent_node_version >/dev/null
agent_bootstrap_system
agent_ensure_node
agent_ensure_bun
agent_persist_environment
