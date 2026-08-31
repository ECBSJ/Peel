#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Peel uninstall script
#
# Removes:
#   1. @peelbtc/sdk  — the globally installed npm package
#   2. Peel skills   — context files from detected AI agent directories
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ECBSJ/Peel/main/uninstall.sh | bash
# ---------------------------------------------------------------------------

REPO="ECBSJ/Peel"
SKILL_NAME="peel"
NPM_PACKAGE="@peelbtc/sdk"

# Known agent directories (relative to $HOME) and their display names
AGENT_DIRS=(
  ".agents|Universal"
  ".claude|Claude Code"
  ".copilot|GitHub Copilot"
  ".cursor|Cursor"
  ".config/agents|Amp"
  ".codex|Codex"
  ".gemini|Gemini CLI"
  ".windsurf|Windsurf"
  ".codeium/windsurf|Windsurf (Codeium)"
  ".config/opencode|OpenCode"
  ".config/goose|Goose"
  ".continue|Continue"
  ".roo|Roo"
  ".kiro|Kiro"
  ".augment|Augment"
  ".ori|Ori"
  ".prime|Prime"
  ".dsh|Dsh"
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m  !\033[0m %s\n' "$*"; }
err()   { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Uninstall npm package
# ---------------------------------------------------------------------------

uninstall_sdk() {
  info "Uninstalling ${NPM_PACKAGE}..."

  if command -v pnpm &>/dev/null; then
    if pnpm remove -g "$NPM_PACKAGE" --silent 2>/dev/null; then
      ok "Removed via pnpm"
    else
      warn "Package not found via pnpm (may already be uninstalled)"
    fi
  elif command -v npm &>/dev/null; then
    if npm uninstall -g "$NPM_PACKAGE" --quiet 2>/dev/null; then
      ok "Removed via npm"
    else
      warn "Package not found via npm (may already be uninstalled)"
    fi
  elif command -v bun &>/dev/null; then
    if bun remove -g "$NPM_PACKAGE" 2>/dev/null; then
      ok "Removed via bun"
    else
      warn "Package not found via bun (may already be uninstalled)"
    fi
  else
    warn "No package manager found (npm, pnpm, or bun required). Skipping SDK removal."
  fi
}

# ---------------------------------------------------------------------------
# 2. Remove Peel skills from every detected agent directory
# ---------------------------------------------------------------------------

uninstall_skills() {
  info "Removing Peel skills from agent directories..."

  local removed_agents=""
  local count=0

  for entry in "${AGENT_DIRS[@]}"; do
    local dir_rel agent_name
    dir_rel="${entry%%|*}"
    agent_name="${entry##*|}"

    local skill_dir="${HOME}/${dir_rel}/skills/${SKILL_NAME}"
    [ -d "$skill_dir" ] || continue

    if rm -rf "$skill_dir"; then
      count=$((count + 1))
      if [ -n "$removed_agents" ]; then
        removed_agents="${removed_agents}, ${agent_name}"
      else
        removed_agents="$agent_name"
      fi
    else
      warn "Could not remove skills for ${agent_name}"
    fi
  done

  if [ "$count" -gt 0 ]; then
    ok "Skills removed from ${count} agent(s): ${removed_agents}"
  else
    warn "No Peel skills found in detected agent directories"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  echo
  printf '\033[1;37m  🍊 Peel Uninstaller\033[0m\n'
  echo

  uninstall_sdk
  echo

  uninstall_skills
  echo

  info "Done. Peel has been uninstalled."
  echo
}

main
