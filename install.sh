#!/usr/bin/env sh
set -eu

# Install the public Astrale CLI binary.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
#   wget -qO- https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
#
# Optional environment:
#   ASTRALE_INSTALL_DIR  install directory (default: ~/.astrale/bin)
#   ASTRALE_VERSION      exact release tag/version to install (for example 0.4.0-alpha.7)
#   ASTRALE_CHANNEL      release channel when ASTRALE_VERSION is unset (alpha|beta|rc|canary|stable)
#   ASTRALE_REPO         GitHub repo override (default: astrale-os/cli)
#   ASTRALE_DOWNLOAD_BASE  direct asset base URL override

BOLD="$(printf '\033[1m')"
DIM="$(printf '\033[2m')"
GREEN="$(printf '\033[0;32m')"
RED="$(printf '\033[0;31m')"
YELLOW="$(printf '\033[0;33m')"
CYAN="$(printf '\033[0;36m')"
NC="$(printf '\033[0m')"

info() { printf '%s\n' "${CYAN}i${NC} $*"; }
success() { printf '%s\n' "${GREEN}ok${NC} $*"; }
warn() { printf '%s\n' "${YELLOW}warn${NC} $*"; }
error() {
  printf '%s\n' "${RED}error${NC} $*" >&2
  exit 1
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

need() {
  command -v "$1" >/dev/null 2>&1 || error "Missing required command: $1"
}

download() {
  url="$1"
  out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$out"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$out"
  else
    error "Install curl or wget, then rerun the installer."
  fi
}

detect_os() {
  case "$(uname -s)" in
    Darwin) printf 'darwin' ;;
    Linux) printf 'linux' ;;
    *) error "Unsupported OS: $(uname -s). Astrale supports macOS and Linux." ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    arm64 | aarch64) printf 'arm64' ;;
    x86_64 | amd64) printf 'x64' ;;
    *) error "Unsupported CPU architecture: $(uname -m). Astrale supports arm64 and x64." ;;
  esac
}

resolve_download_base() {
  if [ -n "${ASTRALE_DOWNLOAD_BASE:-}" ]; then
    printf '%s' "${ASTRALE_DOWNLOAD_BASE%/}"
    return
  fi

  repo="${ASTRALE_REPO:-astrale-os/cli}"
  if [ -n "${ASTRALE_VERSION:-}" ]; then
    version="${ASTRALE_VERSION#cli/v}"
    version="${version#v}"
    printf 'https://github.com/%s/releases/download/cli/v%s' "$repo" "$version"
    return
  fi

  channel="${ASTRALE_CHANNEL:-alpha}"
  printf 'https://github.com/%s/releases/download/%s' "$repo" "$channel"
}

verify_checksum() {
  archive="$1"
  checksums="$2"
  name="$(basename "$archive")"

  if command -v shasum >/dev/null 2>&1; then
    expected="$(grep "  $name\$" "$checksums" | awk '{print $1}' || true)"
    actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    expected="$(grep "  $name\$" "$checksums" | awk '{print $1}' || true)"
    actual="$(sha256sum "$archive" | awk '{print $1}')"
  else
    error "Missing shasum or sha256sum; cannot verify download."
  fi

  [ -n "$expected" ] || error "Checksum entry not found for $name"
  [ "$expected" = "$actual" ] || error "Checksum mismatch for $name"
}

main() {
  os="$(detect_os)"
  arch="$(detect_arch)"
  install_dir="${ASTRALE_INSTALL_DIR:-$HOME/.astrale/bin}"
  asset="astrale-${os}-${arch}.tar.gz"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' 0

  need tar
  base="$(resolve_download_base)"

  printf '\n%sAstrale CLI installer%s\n' "$BOLD" "$NC"
  info "platform: ${os}/${arch}"
  info "install dir: $install_dir"
  info "release: $base"

  download "$base/$asset" "$tmp/$asset"
  download "$base/sha256sums.txt" "$tmp/sha256sums.txt"
  verify_checksum "$tmp/$asset" "$tmp/sha256sums.txt"

  mkdir -p "$install_dir"
  tar -xzf "$tmp/$asset" -C "$tmp"
  install -m 0755 "$tmp/astrale" "$install_dir/astrale"

  installed_version="$("$install_dir/astrale" --version)"
  channel="${ASTRALE_CHANNEL:-alpha}"
  repo="${ASTRALE_REPO:-astrale-os/cli}"
  metadata_dir="${ASTRALE_HOME:-$HOME/.astrale}"
  mkdir -p "$metadata_dir"
  escaped_channel="$(json_escape "$channel")"
  escaped_version="$(json_escape "$installed_version")"
  escaped_repo="$(json_escape "$repo")"
  escaped_bin="$(json_escape "$install_dir/astrale")"
  cat > "$metadata_dir/install.json" <<EOF
{
  "method": "script",
  "channel": "$escaped_channel",
  "version": "$escaped_version",
  "repo": "$escaped_repo",
  "bin": "$escaped_bin",
  "installedAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
EOF

  success "installed $installed_version to $install_dir/astrale"

  case ":$PATH:" in
    *":$install_dir:"*) ;;
    *)
      warn "$install_dir is not on PATH"
      printf '%s\n' "Add this to your shell profile:"
      printf '%s\n' "  export PATH=\"$install_dir:\$PATH\""
      ;;
  esac

  printf '\nNext:\n'
  printf '  astrale auth login\n'
  printf '  astrale instance create <slug>\n'
}

main "$@"
