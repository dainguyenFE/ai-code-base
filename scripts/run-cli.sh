#!/usr/bin/env bash
# Run ai-trace CLI from a parent project that uses this repo as a git submodule.
#
# Usage (from parent project root):
#   bash tools/ai-code-trace-agent/scripts/run-cli.sh index
#   bash tools/ai-code-trace-agent/scripts/run-cli.sh trace component BlogDetail
set -euo pipefail

TOOL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -d "$TOOL_ROOT/node_modules" ]]; then
  echo "ai-code-trace-agent is not set up yet."
  echo "Run: bash tools/ai-code-trace-agent/scripts/setup-submodule.sh"
  exit 1
fi

# Index/trace the parent project, not the tool repo
export AI_TRACE_ROOT="${AI_TRACE_ROOT:-$PWD}"

exec bun "$TOOL_ROOT/apps/cli/src/index.ts" "$@"
