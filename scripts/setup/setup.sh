#!/usr/bin/env bash
# Stable consumer bootstrap. setup.lock contains an exact version and archive SHA-256.
set -euo pipefail
directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd "$directory/../.." && pwd -P)"
action="${1:-prepare}"
case "$action" in prepare|verify|artifacts|claude) ;; *) echo 'Unknown setup action' >&2; exit 1;; esac
read -r version digest extra < "$directory/setup.lock"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$digest" =~ ^[a-f0-9]{64}$ && -z "${extra:-}" ]] || {
  echo 'Invalid setup.lock: expected exact version and SHA-256' >&2; exit 1;
}
cache="${XDG_CACHE_HOME:-$HOME/.cache}/astrale-agent-setup/$version/$digest"
archive="$cache/package.tgz"
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi; }
valid() { [[ -f "$archive" && "$(sha "$archive" | cut -d ' ' -f 1)" == "$digest" ]]; }
if ! valid; then
  [[ "$action" != verify ]] || { echo 'Setup package absent or corrupt; run setup first' >&2; exit 1; }
  # A local Claude hook only reloads existing paths; it must never fetch tooling.
  if [[ "$action" == claude && "${CLAUDE_CODE_REMOTE:-}" != true ]]; then exit 0; fi
  mkdir -p "$cache"
  download="$(mktemp "$cache/download.XXXXXX")"
  trap 'rm -f "$download"' EXIT
  curl --fail --location --silent --show-error --retry 2 --connect-timeout 20 --max-time 300 \
    "https://github.com/astrale-os/config/releases/download/setup-v$version/astrale-setup-$version.tar.gz" -o "$download"
  [[ "$(sha "$download" | cut -d ' ' -f 1)" == "$digest" ]] || { echo 'Setup archive integrity mismatch' >&2; exit 1; }
  mv "$download" "$archive"
fi
# Extract authenticated bytes into a fresh private directory. Never execute a
# mutable extracted cache; concurrent callers share only the verified archive.
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
tar -xzf "$archive" -C "$temporary"
bash "$temporary/package/run.sh" "$root" "$action"
