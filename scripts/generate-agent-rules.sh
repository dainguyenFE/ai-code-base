#!/usr/bin/env bash
# Generate code-trace agent instructions for Cursor, Copilot, Claude/AGENTS, etc.
#
# Usage (from parent project root):
#   bash tools/ai-code-trace-agent/scripts/generate-agent-rules.sh
#   bash tools/ai-code-trace-agent/scripts/generate-agent-rules.sh --target cursor
#   bash tools/ai-code-trace-agent/scripts/generate-agent-rules.sh --target all
#
# Targets: cursor | copilot | agents | all (default: all)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="${AI_TRACE_ROOT:-$PWD}"
SOURCE="$TOOL_ROOT/templates/agent-instructions/code-trace.md"
TARGET="all"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="${2:?--target requires a value}"
      shift 2
      ;;
    -h | --help)
      echo "Usage: generate-agent-rules.sh [--target cursor|copilot|agents|all]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$SOURCE" ]]; then
  echo "Missing template: $SOURCE" >&2
  exit 1
fi

BODY="$(cat "$SOURCE")"
GENERATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

write_cursor() {
  local rules_dir="$ROOT/.cursor/rules"
  mkdir -p "$rules_dir"

  # Remove legacy split rules (consolidated into one file)
  rm -f \
    "$rules_dir/ai-trace-context.mdc" \
    "$rules_dir/project-overview.mdc" \
    "$rules_dir/code-trace.mdc"

  cat >"$rules_dir/code-trace.mdc" <<EOF
---
description: Code trace workflow using local ai-trace index (components, hooks, routes)
alwaysApply: true
---

$BODY
EOF
  echo "Created $rules_dir/code-trace.mdc"
}

write_copilot() {
  local instructions_dir="$ROOT/.github/instructions"
  mkdir -p "$instructions_dir"

  cat >"$instructions_dir/code-trace.instructions.md" <<EOF
---
name: "Code Trace"
description: "Trace components, hooks, and routes from the local ai-trace index"
applyTo: "**/*"
---

$BODY
EOF
  echo "Created $instructions_dir/code-trace.instructions.md"
}

write_agents_doc() {
  local agents_dir="$ROOT/docs/agents"
  mkdir -p "$agents_dir"

  cat >"$agents_dir/code-trace.md" <<EOF
# Code Trace — Agent Instructions

> Auto-generated at $GENERATED_AT.
> Source template: \`tools/ai-code-trace-agent/templates/agent-instructions/code-trace.md\`
> Regenerate: \`bun run trace -- agents\`

$BODY
EOF
  echo "Created $agents_dir/code-trace.md"
}

patch_agents_md() {
  local agents_md="$ROOT/AGENTS.md"
  local marker_start="<!-- ai-trace-agents:start -->"
  local marker_end="<!-- ai-trace-agents:end -->"
  local block

  block="$marker_start
## Local code trace

Follow [\`docs/agents/code-trace.md\`](docs/agents/code-trace.md) when the user asks to trace a component, hook, route, or data flow. Examples (simple → complex): [\`docs/agents/code-trace-examples.md\`](docs/agents/code-trace-examples.md).

Regenerate agent instructions: \`bun run trace -- agents\`
$marker_end"

  if [[ ! -f "$agents_md" ]]; then
    cat >"$agents_md" <<EOF
# AGENTS.md

$block
EOF
    echo "Created $agents_md"
    return
  fi

  if grep -q "$marker_start" "$agents_md"; then
    python3 - <<PY
from pathlib import Path
import re

path = Path("$agents_md")
text = path.read_text()
block = """$block"""
text = re.sub(
    r"<!-- ai-trace-agents:start -->.*?<!-- ai-trace-agents:end -->",
    block,
    text,
    flags=re.DOTALL,
)
path.write_text(text)
PY
    echo "Updated $agents_md (ai-trace section)"
  else
    printf '\n%s\n' "$block" >>"$agents_md"
    echo "Appended ai-trace section to $agents_md"
  fi
}

case "$TARGET" in
  cursor)
    write_cursor
    ;;
  copilot)
    write_copilot
    ;;
  agents)
    write_agents_doc
    patch_agents_md
    ;;
  all)
    write_cursor
    write_copilot
    write_agents_doc
    patch_agents_md
    ;;
  *)
    echo "Unknown target: $TARGET (use cursor|copilot|agents|all)" >&2
    exit 1
    ;;
esac

echo "Done. Targets: $TARGET"
