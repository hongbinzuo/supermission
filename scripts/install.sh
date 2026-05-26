#!/usr/bin/env bash
set -euo pipefail

# Supermission installer
# Usage: curl -fsSL https://raw.githubusercontent.com/hongbinzuo/supermission/main/scripts/install.sh | bash

REPO="hongbinzuo/supermission"
INSTALL_DIR="${SUPERMISSION_INSTALL_DIR:-$HOME/.supermission-cli}"
BIN_DIR="${SUPERMISSION_BIN_DIR:-$HOME/.local/bin}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { printf "${BLUE}▸${NC} %s\n" "$1"; }
success() { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$1"; }
error() { printf "${RED}✗${NC} %s\n" "$1" >&2; exit 1; }

# --- Detect platform ---
detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) OS="darwin" ;;
    Linux)  OS="linux" ;;
    *)      error "Unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64)  ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)             error "Unsupported architecture: $arch" ;;
  esac
}

# --- Check dependencies ---
check_deps() {
  if ! command -v git &>/dev/null; then
    error "git is required but not installed."
  fi

  # Check for bun or node
  if command -v bun &>/dev/null; then
    RUNTIME="bun"
    RUNTIME_VERSION="$(bun --version 2>/dev/null || echo 'unknown')"
    success "Found Bun $RUNTIME_VERSION"
  elif command -v node &>/dev/null; then
    RUNTIME="node"
    RUNTIME_VERSION="$(node --version 2>/dev/null || echo 'unknown')"
    local major
    major="$(echo "$RUNTIME_VERSION" | sed 's/v//' | cut -d. -f1)"
    if [ "$major" -lt 22 ]; then
      error "Node.js >= 22 required (found $RUNTIME_VERSION). Install Bun instead: curl -fsSL https://bun.sh/install | bash"
    fi
    success "Found Node.js $RUNTIME_VERSION"
  else
    info "No runtime found. Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    RUNTIME="bun"
    RUNTIME_VERSION="$(bun --version 2>/dev/null || echo 'unknown')"
    success "Installed Bun $RUNTIME_VERSION"
  fi
}

# --- Install from source ---
install_from_source() {
  info "Installing Supermission from source..."

  # Clone or update
  if [ -d "$INSTALL_DIR" ]; then
    info "Updating existing installation..."
    git -C "$INSTALL_DIR" pull --ff-only 2>/dev/null || {
      warn "Pull failed, re-cloning..."
      rm -rf "$INSTALL_DIR"
      git clone --depth 1 "https://github.com/$REPO.git" "$INSTALL_DIR"
    }
  else
    git clone --depth 1 "https://github.com/$REPO.git" "$INSTALL_DIR"
  fi

  # Install dependencies
  info "Installing dependencies..."
  if [ "$RUNTIME" = "bun" ]; then
    (cd "$INSTALL_DIR" && bun install --frozen-lockfile 2>/dev/null || bun install)
  else
    (cd "$INSTALL_DIR" && npm install --production=false)
  fi

  # Build
  info "Building..."
  if [ "$RUNTIME" = "bun" ]; then
    (cd "$INSTALL_DIR" && bun run build)
  else
    (cd "$INSTALL_DIR" && npx tsup src/cli.ts --format esm --dts --clean --out-dir dist)
  fi

  success "Built successfully"
}

# --- Create symlink ---
create_symlink() {
  mkdir -p "$BIN_DIR"

  local target="$INSTALL_DIR/bin/supermission"
  local link="$BIN_DIR/supermission"

  if [ -L "$link" ] || [ -f "$link" ]; then
    rm -f "$link"
  fi

  ln -s "$target" "$link"
  chmod +x "$target"
  success "Linked: $link → $target"
}

# --- Check PATH ---
check_path() {
  if ! echo "$PATH" | tr ':' '\n' | grep -q "^$BIN_DIR$"; then
    warn "$BIN_DIR is not in your PATH."
    echo ""
    echo "Add this to your shell profile (~/.zshrc, ~/.bashrc, etc.):"
    echo ""
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    echo ""
  fi
}

# --- Detect available agent CLIs ---
detect_agents() {
  echo ""
  info "Detecting agent CLIs on PATH..."
  local found=0
  local agents=("codex" "claude" "kiro" "kimi" "gemini" "aider" "opencode" "gh" "q" "goose" "grok")
  local labels=("OpenAI Codex" "Claude Code" "Kiro" "Kimi" "Gemini CLI" "Aider" "OpenCode" "GitHub Copilot" "Amazon Q" "Goose" "Grok")

  for i in "${!agents[@]}"; do
    if command -v "${agents[$i]}" &>/dev/null; then
      success "  ${labels[$i]} (${agents[$i]})"
      found=$((found + 1))
    fi
  done

  if [ "$found" -eq 0 ]; then
    warn "No agent CLIs found. You can still use --backend shell."
    warn "Install one: codex, claude, kiro, kimi, gemini, aider, opencode, goose"
  else
    success "$found agent CLI(s) detected"
  fi
}

# --- Print success ---
print_success() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  success "Supermission installed successfully!"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Get started:"
  echo ""
  echo "    cd your-project"
  echo "    supermission init                    # detect runners, set defaults"
  echo "    supermission quick \"Your task\"       # run a task end-to-end"
  echo ""
  echo "  Or step by step:"
  echo ""
  echo "    supermission new \"Fix the login bug\" --validation \"npm test\""
  echo "    supermission plan <work-id>"
  echo "    supermission approve <work-id>"
  echo "    supermission run <work-id> --backend claude"
  echo "    supermission validate <work-id>"
  echo ""
  echo "  More: supermission --help"
  echo ""
}

# --- Main ---
main() {
  echo ""
  echo "  ╔═══════════════════════════════════════╗"
  echo "  ║       Supermission Installer          ║"
  echo "  ║  Local-first AI work records          ║"
  echo "  ╚═══════════════════════════════════════╝"
  echo ""

  detect_platform
  info "Platform: $OS/$ARCH"

  check_deps
  install_from_source
  create_symlink
  check_path
  detect_agents
  print_success
}

main "$@"
