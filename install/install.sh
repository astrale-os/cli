#!/usr/bin/env bash
set -euo pipefail

# ─── Astrale Installer ──────────────────────────────────────────
#
# Usage:
#   curl -fsSL https://install.astrale.ai | bash
#
# Requirements:
#   - macOS or Linux
#   - Docker installed and running
#   - Internet connection
#

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}i${NC} $1"; }
success() { echo -e "${GREEN}✔${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
error()   { echo -e "${RED}✖${NC} $1"; exit 1; }

echo ""
echo -e "${BOLD}  Astrale Installer${NC}"
echo -e "${DIM}  Setting up your local Astrale environment${NC}"
echo ""

# ── 1. OS Detection ─────────────────────────────────────────────

OS=$(uname -s)
case "$OS" in
  Darwin) info "Detected macOS" ;;
  Linux)  info "Detected Linux" ;;
  *)      error "Unsupported OS: $OS. Astrale supports macOS and Linux." ;;
esac

# ── 2. Docker Check ─────────────────────────────────────────────

if ! command -v docker &> /dev/null; then
  error "Docker is not installed. Install it from https://docs.docker.com/get-docker/"
fi

if ! docker info &> /dev/null; then
  error "Docker is not running. Please start Docker and try again."
fi

success "Docker is running"

# ── 3. Bun Check / Install ──────────────────────────────────────

if command -v bun &> /dev/null; then
  BUN_VERSION=$(bun --version)
  success "Bun $BUN_VERSION detected"
else
  info "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  success "Bun installed"
fi

# ── 4. Install Astrale CLI ──────────────────────────────────────

info "Installing Astrale CLI..."

if [ -n "${ASTRALE_LOCAL_PATH:-}" ]; then
  # Dev mode: install from local path
  cd "$ASTRALE_LOCAL_PATH"
  bun link
  cd -
  bun link @astrale-os/astrale
else
  bun install -g @astrale-os/astrale
fi

success "Astrale CLI installed"

# ── 5. Run init ─────────────────────────────────────────────────

echo ""
info "Running astrale init..."
echo ""

astrale init
