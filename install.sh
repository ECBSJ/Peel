#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Peel install script
#
# Installs:
#   1. @peelbtc/sdk  — the npm package (requires Node.js ≥18)
#   2. Peel skills   — context files for AI agent coding assistants
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ECBSJ/Peel/main/install.sh | bash
# ---------------------------------------------------------------------------

REPO="ECBSJ/Peel"
SKILL_NAME="peel"
SKILL_RAW_BASE="https://raw.githubusercontent.com/${REPO}/main/skills/${SKILL_NAME}"
NPM_PACKAGE="@peelbtc/sdk@alpha"
MIN_NODE_MAJOR=18

# Skill files relative to skills/peel/
SKILL_FILES=(
  "SKILL.md"
  "references/core.md"
  "references/sdk.md"
  "references/router.md"
  "references/bridging/bob-gateway.md"
  "references/bridging/rootstock-flyover.md"
  "references/bridging/sbtc.md"
)

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

TMPDIR_PEEL=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m  !\033[0m %s\n' "$*"; }
err()   { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  [ -n "$TMPDIR_PEEL" ] && [ -d "$TMPDIR_PEEL" ] && rm -rf "$TMPDIR_PEEL"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Check Node.js
# ---------------------------------------------------------------------------

check_node() {
  info "Checking Node.js..."

  if ! command -v node &>/dev/null; then
    err "Node.js is not installed. Install Node.js ${MIN_NODE_MAJOR}+ from https://nodejs.org and re-run this script."
  fi

  local version major
  version="$(node --version)"           # e.g. v20.11.0
  major="${version#v}"                   # strip leading v
  major="${major%%.*}"                   # keep major only

  if [ "$major" -lt "$MIN_NODE_MAJOR" ]; then
    err "Node.js ${version} is installed but Peel requires v${MIN_NODE_MAJOR}+. Please upgrade."
  fi

  ok "Node.js ${version}"
}

# ---------------------------------------------------------------------------
# 2. Install npm package
# ---------------------------------------------------------------------------

install_sdk() {
  info "Installing ${NPM_PACKAGE}..."

  # Prefer the package manager that is already available
  if command -v pnpm &>/dev/null; then
    pnpm add -g "$NPM_PACKAGE" --silent
    ok "Installed via pnpm"
  elif command -v npm &>/dev/null; then
    npm install -g "$NPM_PACKAGE" --quiet
    ok "Installed via npm"
  elif command -v bun &>/dev/null; then
    bun add -g "$NPM_PACKAGE"
    ok "Installed via bun"
  else
    err "No package manager found (npm, pnpm, or bun required)."
  fi
}

# ---------------------------------------------------------------------------
# 3. Download skill files into a temp directory
# ---------------------------------------------------------------------------

download_skills() {
  info "Downloading Peel skills..."

  TMPDIR_PEEL="$(mktemp -d)"
  local staging="${TMPDIR_PEEL}/skill"

  # Create directory structure
  mkdir -p \
    "$staging" \
    "$staging/references" \
    "$staging/references/bridging"

  local failed=0
  for file in "${SKILL_FILES[@]}"; do
    local url="${SKILL_RAW_BASE}/${file}"
    local dest="${staging}/${file}"
    if curl -fsSL -o "$dest" "$url" 2>/dev/null; then
      : # success
    else
      warn "Could not download ${file} — skipping"
      failed=$((failed + 1))
    fi
  done

  if [ "$failed" -ge "${#SKILL_FILES[@]}" ]; then
    warn "All skill files failed to download — skills not installed"
    return 1
  fi

  ok "Downloaded ${#SKILL_FILES[@]} skill files"
  return 0
}

# ---------------------------------------------------------------------------
# 4. Copy skills to every detected agent directory
# ---------------------------------------------------------------------------

install_skills() {
  local staging="${TMPDIR_PEEL}/skill"
  local installed_agents=""
  local count=0

  for entry in "${AGENT_DIRS[@]}"; do
    local dir_rel agent_name
    dir_rel="${entry%%|*}"
    agent_name="${entry##*|}"

    local parent="${HOME}/${dir_rel}"
    [ -d "$parent" ] || continue

    local dest="${parent}/skills/${SKILL_NAME}"
    mkdir -p \
      "$dest" \
      "$dest/references" \
      "$dest/references/bridging" 2>/dev/null || continue

    # Copy all skill files (best-effort)
    local any_copied=0
    for file in "${SKILL_FILES[@]}"; do
      local src="${staging}/${file}"
      local dst="${dest}/${file}"
      [ -f "$src" ] || continue
      if cp "$src" "$dst" 2>/dev/null; then
        any_copied=1
      fi
    done

    if [ "$any_copied" -eq 1 ]; then
      count=$((count + 1))
      if [ -n "$installed_agents" ]; then
        installed_agents="${installed_agents}, ${agent_name}"
      else
        installed_agents="$agent_name"
      fi
    fi
  done

  if [ "$count" -gt 0 ]; then
    ok "Skills installed for ${count} agent(s): ${installed_agents}"
  else
    warn "No coding agents detected — skills not installed"
    warn "Re-run this script after setting up an agent (Claude Code, Cursor, GitHub Copilot, etc.)"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  echo
  printf '\033[1;37m  🍊 Peel — A Payments Engine for Every Layer\033[0m\n'
  echo

  check_node
  echo

  install_sdk
  echo

  if download_skills; then
    install_skills
  fi

  echo
  info "Done! Get started:"
  echo
  echo "  import { routePayment } from \"@peelbtc/sdk\""
  echo "  import { buildBridIdentityMap } from \"@peelbtc/core\""
  echo
  echo "  Docs:  https://github.com/ECBSJ/Peel"
  echo "  npm:   https://www.npmjs.com/package/@peelbtc/sdk"
  echo
}

main
