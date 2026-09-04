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

json_string_field() {
  file="$1"
  field="$2"
  sed -n "s/^[[:space:]]*\"$field\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" | head -n 1
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

  channel="${ASTRALE_CHANNEL:-beta}"
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

release_install_lock() {
  [ "${lock_owned:-0}" -eq 1 ] || return 0
  retained="$(sed -n '1p' "$lock_dir/owner" 2>/dev/null || true)"
  if [ "$retained" = "$lock_owner" ]; then
    rm -rf "$lock_dir"
    lock_owned=0
  else
    warn "Astrale install lock ownership changed at $lock_dir; leaving it untouched."
  fi
}

acquire_install_lock() {
  lock_dir="$install_dir/.astrale-install.lock"
  lock_owner="$$ $$-$(date -u '+%s')"
  lock_owned=0
  attempt=0
  while ! mkdir "$lock_dir" 2>/dev/null; do
    retained="$(sed -n '1p' "$lock_dir/owner" 2>/dev/null || true)"
    owner_pid="${retained%% *}"
    owner_token="${retained#* }"
    case "$owner_pid" in
      '' | *[!0-9]* | 0) error "Invalid Astrale install lock at $lock_dir; refusing to replace an unknown owner." ;;
    esac
    case "$owner_token" in
      '' | *[!A-Za-z0-9-]*) error "Invalid Astrale install lock at $lock_dir; refusing to replace an unknown owner." ;;
    esac
    if kill -0 "$owner_pid" 2>/dev/null || ps -p "$owner_pid" >/dev/null 2>&1; then
      error "Another Astrale install or update is running (pid $owner_pid)."
    fi
    attempt=$((attempt + 1))
    [ "$attempt" -le 3 ] || error "Astrale install lock changed repeatedly; retry the installer."
    stale="$lock_dir.stale-$$-$attempt"
    if mv "$lock_dir" "$stale" 2>/dev/null; then
      rm -rf "$stale"
    fi
  done
  printf '%s\n' "$lock_owner" > "$lock_dir/owner"
  lock_owned=1
}

main() {
  os="$(detect_os)"
  arch="$(detect_arch)"
  install_dir="${ASTRALE_INSTALL_DIR:-$HOME/.astrale/bin}"
  metadata_dir="${ASTRALE_HOME:-$HOME/.astrale}"
  asset="astrale-${os}-${arch}.tar.gz"
  tmp="$(mktemp -d)"
  cleanup() {
    rm -rf "$tmp"
    release_install_lock
  }
  trap cleanup 0

  mkdir -p "$install_dir" "$metadata_dir"
  acquire_install_lock

  need tar
  base="$(resolve_download_base)"

  printf '\n%sAstrale CLI installer%s\n' "$BOLD" "$NC"
  info "platform: ${os}/${arch}"
  info "install dir: $install_dir"
  info "release: $base"

  download "$base/$asset" "$tmp/$asset"
  download "$base/sha256sums.txt" "$tmp/sha256sums.txt"
  download "$base/manifest.json" "$tmp/manifest.json"
  verify_checksum "$tmp/$asset" "$tmp/sha256sums.txt"

  # The single-binary format is understood by already installed CLIs. V2 is
  # retained only to install explicitly selected historical releases.
  schema_version="$(sed -n 's/^[[:space:]]*"schemaVersion"[[:space:]]*:[[:space:]]*\([^,}]*\).*/\1/p' "$tmp/manifest.json" | tr -d '[:space:]')"
  cloudflared_version="$(json_string_field "$tmp/manifest.json" cloudflaredVersion)"
  case "$schema_version" in
    '')
      [ -z "$cloudflared_version" ] || error "Unexpected companion in a single-binary release manifest."
      expected_archive_files="astrale"
      ;;
    2)
      [ -n "$cloudflared_version" ] || error "Release manifest is missing cloudflaredVersion."
      expected_archive_files="astrale
astrale-cloudflared
LICENSE.cloudflared"
      ;;
    *) error "Unsupported release manifest schemaVersion." ;;
  esac
  archive_files="$(tar -tzf "$tmp/$asset")" || error "Could not inspect $asset."
  [ "$archive_files" = "$expected_archive_files" ] || error "Release archive has an invalid toolchain closure."
  tar -xzf "$tmp/$asset" -C "$tmp"
  binary_version="$(json_string_field "$tmp/manifest.json" binaryVersion)"
  [ -n "$binary_version" ] || error "Release manifest is missing binaryVersion."
  [ "$("$tmp/astrale" --version)" = "$binary_version" ] || error "astrale version does not match the release manifest."
  if [ "$schema_version" = 2 ]; then
    cloudflared_reported="$("$tmp/astrale-cloudflared" --version)"
    case "$cloudflared_reported" in
      "cloudflared version $cloudflared_version "*|"cloudflared version $cloudflared_version") ;;
      *) error "astrale-cloudflared version does not match the release manifest." ;;
    esac
  fi

  bin="$install_dir/astrale"
  rm -f "$bin.next"
  if [ -f "$bin" ]; then cp "$bin" "$bin.previous"; had_bin=1; else rm -f "$bin.previous"; had_bin=0; fi
  install -m 0755 "$tmp/astrale" "$bin.next"

  if [ "$schema_version" = 2 ]; then
    cloudflared="$install_dir/astrale-cloudflared"
    license_dir="$metadata_dir/licenses"
    license="$license_dir/cloudflared.txt"
    mkdir -p "$license_dir"

    rm -f "$cloudflared.next" "$license.next"
    if [ -f "$cloudflared" ]; then
      cp "$cloudflared" "$cloudflared.previous"
      had_cloudflared=1
    else
      rm -f "$cloudflared.previous"
      had_cloudflared=0
    fi
    if [ -f "$license" ]; then
      cp "$license" "$license.previous"
      had_license=1
    else
      rm -f "$license.previous"
      had_license=0
    fi
    install -m 0755 "$tmp/astrale-cloudflared" "$cloudflared.next"
    install -m 0644 "$tmp/LICENSE.cloudflared" "$license.next"
  fi

  rollback_cohort() {
    if [ "$had_bin" -eq 1 ]; then cp "$bin.previous" "$bin" && chmod 0755 "$bin"; else rm -f "$bin"; fi
    [ "$schema_version" = 2 ] || return 0
    if [ "$had_cloudflared" -eq 1 ]; then
      cp "$cloudflared.previous" "$cloudflared" && chmod 0755 "$cloudflared"
    else
      rm -f "$cloudflared"
    fi
    if [ "$had_license" -eq 1 ]; then
      cp "$license.previous" "$license" && chmod 0644 "$license"
    else
      rm -f "$license"
    fi
  }

  if [ "$schema_version" = 2 ]; then
    if ! mv "$license.next" "$license" || ! mv "$cloudflared.next" "$cloudflared"; then
      rollback_cohort
      error "Could not commit the Astrale toolchain; the previous installation was restored."
    fi
  fi
  if ! mv "$bin.next" "$bin"; then
    rollback_cohort
    error "Could not commit the Astrale toolchain; the previous installation was restored."
  fi

  installed_version="$("$bin" --version)"
  channel="${ASTRALE_CHANNEL:-beta}"
  repo="${ASTRALE_REPO:-astrale-os/cli}"
  release_version="$(json_string_field "$tmp/manifest.json" version)"
  release_channel="$(json_string_field "$tmp/manifest.json" channel)"
  [ -n "$release_version" ] || release_version="$installed_version"
  [ -n "$release_channel" ] || release_channel="$channel"
  escaped_channel="$(json_escape "$release_channel")"
  escaped_version="$(json_escape "$release_version")"
  escaped_repo="$(json_escape "$repo")"
  escaped_bin="$(json_escape "$bin")"
  escaped_binary_version="$(json_escape "$binary_version")"
  escaped_cloudflared_version="$(json_escape "$cloudflared_version")"
  cohort_metadata=""
  if [ "$schema_version" = 2 ]; then
    cohort_metadata="\"cohort\": {\"schemaVersion\": 2, \"binaryVersion\": \"$escaped_binary_version\", \"cloudflaredVersion\": \"$escaped_cloudflared_version\"},"
  fi
  metadata_next="$metadata_dir/install.json.next"
  cat > "$metadata_next" <<EOF
{
  "method": "script",
  "channel": "$escaped_channel",
  "version": "$escaped_version",
  "repo": "$escaped_repo",
  "bin": "$escaped_bin",
  $cohort_metadata
  "installedAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
EOF

  if ! mv "$metadata_next" "$metadata_dir/install.json"; then
    rollback_cohort
    error "Could not commit Astrale install metadata; the previous installation was restored."
  fi
  rm -f "$bin.previous"
  if [ "$schema_version" = 2 ]; then
    rm -f "$cloudflared.previous" "$license.previous"
  fi
  release_install_lock

  success "installed $release_version to $bin"

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

  printf '\nLet your agent drive the GUI (optional):\n'
  printf '  npm install -g agent-browser && agent-browser install\n'
  printf '  npx skills add vercel-labs/agent-browser\n'
  printf '  astrale browser                         # sign in once -> reusable session\n'

  printf '\nConfigure Astrale skills for your coding agents:\n'
  if [ -z "${CI:-}" ] &&
    [ -z "${CONTINUOUS_INTEGRATION:-}" ] &&
    ( : </dev/tty >/dev/tty ) 2>/dev/null
  then
    rm -rf "$tmp"
    trap - 0
    exec "$install_dir/astrale" skills configure --source install </dev/tty >/dev/tty 2>&1
  fi
  printf '  Skill setup skipped. Run: astrale skills configure\n'
}

main "$@"
