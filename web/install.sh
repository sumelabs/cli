#!/usr/bin/env bash
# Sume CLI installer for macOS and Linux.
# Usage:
#   curl https://cli.sume.com/install -fsS | bash
#
# Environment variables:
#   SUME_VERSION        Specific version to install, for example 0.1.6 or v0.1.6.
#                       Defaults to latest.
#   SUME_DIR            Installation root. Defaults to ~/.sume-com.
#   SUME_RELEASE_BASE   GitHub Releases base URL. Defaults to https://github.com/sumelabs/cli/releases.

set -euo pipefail

BINARY_NAME="sume"
SUME_DIR="${SUME_DIR:-$HOME/.sume-com}"
BIN_DIR="${SUME_DIR}/bin"
VERSION="${SUME_VERSION:-latest}"
RELEASE_BASE="${SUME_RELEASE_BASE:-https://github.com/sumelabs/cli/releases}"
RELEASE_BASE="${RELEASE_BASE%/}"

BOLD=""
GREEN=""
YELLOW=""
RED=""
RESET=""

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
  RED="$(printf '\033[31m')"
  RESET="$(printf '\033[0m')"
fi

info() {
  printf "%s%s%s\n" "$BOLD" "$1" "$RESET"
}

success() {
  printf "%s%s%s%s\n" "$GREEN" "$BOLD" "$1" "$RESET"
}

warn() {
  printf "%s%s%s\n" "$YELLOW" "$1" "$RESET" >&2
}

error() {
  printf "%serror: %s%s\n" "$RED" "$1" "$RESET" >&2
  exit 1
}

path_contains() {
  local dir="$1"
  printf "%s" "$PATH" | tr ':' '\n' | grep -qx "$dir"
}

download() {
  local url="$1"
  local output="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --progress-bar -o "$output" "$url" || error "Failed to download $url."
    return
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q --show-progress -O "$output" "$url" || error "Failed to download $url."
    return
  fi

  error "curl or wget is required to download Sume CLI."
}

fetch_text() {
  local url="$1"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" && return 0
    return 1
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO- "$url" && return 0
    return 1
  fi

  error "curl or wget is required to download Sume CLI."
}

detect_platform() {
  local os
  local arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin | darwin)
      PLATFORM_OS="darwin"
      ;;
    Linux | linux)
      PLATFORM_OS="linux"
      ;;
    MINGW* | MSYS* | CYGWIN*)
      error "Use PowerShell on Windows: irm https://cli.sume.com/install.ps1 | iex"
      ;;
    *)
      error "Unsupported operating system: $os"
      ;;
  esac

  case "$arch" in
    x86_64 | amd64)
      PLATFORM_ARCH="x64"
      ;;
    arm64 | aarch64)
      PLATFORM_ARCH="arm64"
      ;;
    *)
      error "Unsupported architecture: $arch"
      ;;
  esac
}

normalize_version() {
  local version="$1"
  if [ "$version" = "latest" ]; then
    printf "%s" "$version"
    return
  fi
  printf "%s" "${version#v}"
}

release_manifest_url() {
  local version="$1"
  if [ "$version" = "latest" ]; then
    printf "%s/latest/download/manifest.json" "$RELEASE_BASE"
  else
    printf "%s/download/v%s/manifest.json" "$RELEASE_BASE" "$version"
  fi
}

checksum_tool() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf "sha256sum"
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    printf "shasum"
    return
  fi
  return 1
}

file_sha256() {
  local file="$1"
  local tool="$2"

  case "$tool" in
    sha256sum)
      sha256sum "$file" | awk '{print $1}'
      ;;
    shasum)
      shasum -a 256 "$file" | awk '{print $1}'
      ;;
    *)
      return 1
      ;;
  esac
}

verify_checksum() {
  local file="$1"
  local expected="$2"
  local tool
  local actual

  if ! tool="$(checksum_tool)"; then
    if [ "$SKIP_CHECKSUM" = "1" ]; then
      warn "Skipping checksum verification because sha256sum/shasum is unavailable and SUME_SKIP_CHECKSUM=1."
      return
    fi
    error "sha256sum or shasum is required for checksum verification. Set SUME_SKIP_CHECKSUM=1 to skip deliberately."
  fi

  actual="$(file_sha256 "$file" "$tool")"
  if [ "$actual" != "$expected" ]; then
    error "Checksum verification failed for downloaded Sume CLI binary."
  fi
}

manifest_field() {
  local manifest="$1"
  local field="$2"

  printf "%s" "$manifest" | tr -d '\n' | sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
}

manifest_asset_field() {
  local manifest="$1"
  local asset_name="$2"
  local field="$3"

  printf "%s" "$manifest" | tr -d '\n' | sed -n "s/.*\"${asset_name}\"[[:space:]]*:[[:space:]]*{[^}]*\"${field}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
}

install_binary() {
  local source="$1"
  local target="$2"

  mkdir -p "$(dirname "$target")"
  if [ -e "$target" ] && [ ! -w "$target" ]; then
    error "Cannot replace existing $target because it is not writable."
  fi

  if command -v install >/dev/null 2>&1; then
    install -m 0755 "$source" "$target"
  else
    cp "$source" "$target"
    chmod 0755 "$target"
  fi
}

try_link_local_bin() {
  local target="$1"
  local local_bin="$HOME/.local/bin"
  local link_path="${local_bin}/${BINARY_NAME}"

  mkdir -p "$local_bin" 2>/dev/null || return 1
  [ -d "$local_bin" ] && [ -w "$local_bin" ] || return 1

  if [ -e "$link_path" ] && [ ! -L "$link_path" ]; then
    return 2
  fi
  if [ -L "$link_path" ]; then
    local current
    current="$(readlink "$link_path" || true)"
    if [ "$current" != "$target" ] && [ -n "$current" ]; then
      return 2
    fi
  fi

  ln -sf "$target" "$link_path" || return 1
  if path_contains "$local_bin"; then
    return 0
  fi
  return 3
}

path_export_line() {
  printf 'export PATH="%s:$HOME/.local/bin:$PATH"' "$BIN_DIR"
}

print_path_guidance() {
  echo ""
  info "Run this once in the current shell to prefer this install:"
  echo ""
  echo "  $(path_export_line)"
}

print_get_started_or_path_warning() {
  local resolved
  resolved="$(command -v "$BINARY_NAME" || true)"

  if [ "$resolved" = "$TARGET" ] || [ "$resolved" = "$HOME/.local/bin/${BINARY_NAME}" ]; then
    info "Run 'sume login' to get started."
    return
  fi

  if [ -n "$resolved" ]; then
    warn "Your shell currently resolves 'sume' to $resolved."
  else
    warn "Your shell does not currently resolve 'sume'."
  fi
  print_path_guidance
}

main() {
  detect_platform

  VERSION="$(normalize_version "$VERSION")"
  ASSET_NAME="${BINARY_NAME}-${PLATFORM_OS}-${PLATFORM_ARCH}"
  MANIFEST="$(fetch_text "$(release_manifest_url "$VERSION")")" || error "Could not fetch Sume CLI release manifest."
  RESOLVED_VERSION="$(manifest_field "$MANIFEST" "version")"
  DOWNLOAD_URL="$(manifest_asset_field "$MANIFEST" "$ASSET_NAME" "url")"
  CHECKSUM="$(manifest_asset_field "$MANIFEST" "$ASSET_NAME" "sha256")"
  [ -n "$RESOLVED_VERSION" ] || error "Release manifest did not include a version."
  [ -n "$DOWNLOAD_URL" ] || error "Release manifest did not include $ASSET_NAME."
  [ -n "$CHECKSUM" ] || error "Release manifest did not include checksum for $ASSET_NAME."
  TARGET="${BIN_DIR}/${BINARY_NAME}"
  EXISTING_SUME="$(command -v "$BINARY_NAME" || true)"
  TMP_DIR="$(mktemp -d)"
  TMP_BINARY="${TMP_DIR}/${ASSET_NAME}"
  trap 'rm -rf "$TMP_DIR"' EXIT

  info "Installing Sume CLI v${RESOLVED_VERSION} (${PLATFORM_OS}-${PLATFORM_ARCH})..."

  if [ -n "$EXISTING_SUME" ] && [ "$EXISTING_SUME" != "$TARGET" ]; then
    warn "Found an existing sume at $EXISTING_SUME. This installer will not overwrite it."
  fi

  download "$DOWNLOAD_URL" "$TMP_BINARY"

  verify_checksum "$TMP_BINARY" "$CHECKSUM"

  install_binary "$TMP_BINARY" "$TARGET"

  if ! "$TARGET" --version >/dev/null 2>&1; then
    error "Installed binary did not pass 'sume --version' smoke check."
  fi

  echo ""
  success "Sume CLI installed at $TARGET"
  echo ""

  if path_contains "$BIN_DIR"; then
    print_get_started_or_path_warning
    return
  fi

  link_status=0
  try_link_local_bin "$TARGET" || link_status="$?"

  case "$link_status" in
    0)
      info "Linked sume into $HOME/.local/bin."
      print_get_started_or_path_warning
      ;;
    2)
      warn "Did not overwrite an existing $HOME/.local/bin/sume."
      warn "Your shell may still resolve 'sume' to the earlier binary."
      print_path_guidance
      ;;
    *)
      warn "Sume CLI is installed, but $BIN_DIR is not on your PATH."
      print_path_guidance
      ;;
  esac
}

main "$@"
