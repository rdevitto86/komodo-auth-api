#!/usr/bin/env bash
# _lib.sh — shared utilities sourced by all scripts in this directory.
# Do not execute directly.
set -euo pipefail

if [[ "${CI:-false}" == "true" ]]; then
  RED="" GREEN="" YELLOW="" BLUE="" BOLD="" RESET=""
else
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  BOLD='\033[1m'
  RESET='\033[0m'
fi

log_info()    { echo -e "${BLUE}[INFO]${RESET}    $*"; }
log_success() { echo -e "${GREEN}[OK]${RESET}      $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}    $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET}   $*" >&2; }
log_section() { echo -e "\n${BOLD}==> $*${RESET}"; }

require_tool() {
  local name="$1"
  local install_cmd="$2"

  if command -v "$name" &>/dev/null; then
    return 0
  fi

  log_warn "'$name' not found on PATH — installing..."
  eval "$install_cmd"

  if ! command -v "$name" &>/dev/null; then
    log_error "Failed to install '$name'. Please install it manually and re-run."
    exit 1
  fi

  log_success "'$name' installed."
}

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}
