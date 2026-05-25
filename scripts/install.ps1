# Supermission installer for Windows
# Usage: irm https://raw.githubusercontent.com/hongbinzuo/supermission/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "hongbinzuo/supermission"
$InstallDir = if ($env:SUPERMISSION_INSTALL_DIR) { $env:SUPERMISSION_INSTALL_DIR } else { "$HOME\.supermission-cli" }
$BinDir = if ($env:SUPERMISSION_BIN_DIR) { $env:SUPERMISSION_BIN_DIR } else { "$HOME\.local\bin" }

function Write-Info { Write-Host "▸ $args" -ForegroundColor Blue }
function Write-Success { Write-Host "✓ $args" -ForegroundColor Green }
function Write-Warn { Write-Host "! $args" -ForegroundColor Yellow }
function Write-Err { Write-Host "✗ $args" -ForegroundColor Red; exit 1 }

# --- Check dependencies ---
function Check-Deps {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Err "git is required but not installed."
    }

    if (Get-Command bun -ErrorAction SilentlyContinue) {
        $script:Runtime = "bun"
        $ver = & bun --version 2>$null
        Write-Success "Found Bun $ver"
    } elseif (Get-Command node -ErrorAction SilentlyContinue) {
        $script:Runtime = "node"
        $ver = & node --version 2>$null
        $major = [int]($ver -replace 'v' -split '\.')[0]
        if ($major -lt 22) {
            Write-Err "Node.js >= 22 required (found $ver). Install Bun: powershell -c 'irm bun.sh/install.ps1 | iex'"
        }
        Write-Success "Found Node.js $ver"
    } else {
        Write-Info "No runtime found. Installing Bun..."
        powershell -c "irm bun.sh/install.ps1 | iex"
        $env:BUN_INSTALL = "$HOME\.bun"
        $env:PATH = "$env:BUN_INSTALL\bin;$env:PATH"
        $script:Runtime = "bun"
        Write-Success "Installed Bun"
    }
}

# --- Install from source ---
function Install-FromSource {
    Write-Info "Installing Supermission from source..."

    if (Test-Path $InstallDir) {
        Write-Info "Updating existing installation..."
        & git -C $InstallDir pull --ff-only 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Pull failed, re-cloning..."
            Remove-Item -Recurse -Force $InstallDir
            & git clone --depth 1 "https://github.com/$Repo.git" $InstallDir
        }
    } else {
        & git clone --depth 1 "https://github.com/$Repo.git" $InstallDir
    }

    Write-Info "Installing dependencies..."
    Push-Location $InstallDir
    if ($script:Runtime -eq "bun") {
        & bun install
    } else {
        & npm install
    }

    Write-Info "Building..."
    if ($script:Runtime -eq "bun") {
        & bun run build
    } else {
        & npx tsup src/cli.ts --format esm --dts --clean --out-dir dist
    }
    Pop-Location

    Write-Success "Built successfully"
}

# --- Create bin script ---
function Create-BinScript {
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

    $scriptContent = @"
@echo off
bun "$InstallDir\src\cli.ts" %*
"@
    $scriptPath = Join-Path $BinDir "supermission.cmd"
    Set-Content -Path $scriptPath -Value $scriptContent
    Write-Success "Created: $scriptPath"
}

# --- Check PATH ---
function Check-Path {
    if ($env:PATH -notlike "*$BinDir*") {
        Write-Warn "$BinDir is not in your PATH."
        Write-Host ""
        Write-Host "  Add to PATH (run once):"
        Write-Host ""
        Write-Host "  [Environment]::SetEnvironmentVariable('PATH', `"$BinDir;`" + [Environment]::GetEnvironmentVariable('PATH', 'User'), 'User')"
        Write-Host ""
    }
}

# --- Detect agents ---
function Detect-Agents {
    Write-Host ""
    Write-Info "Detecting agent CLIs..."
    $agents = @(
        @{cmd="claude"; label="Claude Code"},
        @{cmd="codex"; label="OpenAI Codex"},
        @{cmd="gemini"; label="Gemini CLI"},
        @{cmd="aider"; label="Aider"},
        @{cmd="opencode"; label="OpenCode"},
        @{cmd="gh"; label="GitHub Copilot"},
        @{cmd="q"; label="Amazon Q"},
        @{cmd="goose"; label="Goose"},
        @{cmd="kiro"; label="Kiro"},
        @{cmd="grok"; label="Grok"}
    )
    $found = 0
    foreach ($agent in $agents) {
        if (Get-Command $agent.cmd -ErrorAction SilentlyContinue) {
            Write-Success "  $($agent.label) ($($agent.cmd))"
            $found++
        }
    }
    if ($found -eq 0) {
        Write-Warn "No agent CLIs found. You can still use --backend shell."
    } else {
        Write-Success "$found agent CLI(s) detected"
    }
}

# --- Main ---
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗"
Write-Host "  ║       Supermission Installer          ║"
Write-Host "  ║  Local-first AI work records          ║"
Write-Host "  ╚═══════════════════════════════════════╝"
Write-Host ""

Check-Deps
Install-FromSource
Create-BinScript
Check-Path
Detect-Agents

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Success "Supermission installed successfully!"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "  Get started:"
Write-Host ""
Write-Host "    cd your-project"
Write-Host "    supermission init                    # detect runners"
Write-Host "    supermission quick `"Your task`"       # run end-to-end"
Write-Host ""
