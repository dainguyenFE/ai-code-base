#!/usr/bin/env bash
# One-time setup for ai-code-trace-agent when used as a git submodule.
#
# Run from the parent monorepo root:
#   bun run trace -- setup
#   bash tools/ai-code-trace-agent/scripts/setup-submodule.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PARENT_ROOT="$(cd "$TOOL_ROOT/../.." && pwd)"

info() { echo "[ai-trace] $*"; }
err()  { echo "[ai-trace] ERROR: $*" >&2; }

if ! command -v bun &> /dev/null; then
  err "Bun is required. Install: https://bun.sh"
  exit 1
fi

if [[ ! -f "$TOOL_ROOT/package.json" ]]; then
  err "Submodule not found at $TOOL_ROOT"
  err "Run from the monorepo root: git submodule update --init tools/ai-code-trace-agent"
  exit 1
fi

if [[ -f "$PARENT_ROOT/.gitmodules" ]] && grep -q 'tools/ai-code-trace-agent' "$PARENT_ROOT/.gitmodules"; then
  if [[ ! -e "$TOOL_ROOT/.git" ]]; then
    info "Cloning submodule..."
    (cd "$PARENT_ROOT" && git submodule update --init tools/ai-code-trace-agent)
  else
    info "Submodule already initialized."
  fi
fi

info "Installing dependencies..."
(cd "$TOOL_ROOT" && bun install)

info "ai-code-trace-agent is ready."
info "Next steps:"
info "  bun run trace -- init    # create .ai-trace/config.json"
info "  bun run trace -- index   # scan and index the codebase"
info "  bun run trace -- export  # export context for AI/Cursor"
