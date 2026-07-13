# Phoenix Handbook — build script
#
# Combines metadata.yaml + chapters/*.md into handbook.pdf.
# Reorder, add, or remove chapters by editing the $inputs list below.
#
# Requirements:
#   - Pandoc        https://pandoc.org/installing.html
#   - xelatex       MiKTeX (Windows), MacTeX (macOS), or TeX Live (Linux)

$ErrorActionPreference = "Stop"

# Always run from the handbook directory so the relative paths below resolve
# regardless of the caller's current location.
Set-Location $PSScriptRoot

# Files are passed to Pandoc in this exact order. Chapters and part dividers
# are listed explicitly so reordering is a one-line change.
$inputs = @(
    "metadata.yaml",
    "chapters/front-copyright.md",
    "chapters/part1.md",
    "chapters/ch01-about.md",
    "chapters/ch02-introducing.md",
    "chapters/ch03-installing.md",
    "chapters/ch04-first-launch.md",
    "chapters/ch05-creating-wallet.md",
    "chapters/part2.md",
    "chapters/ch06-tour.md",
    "chapters/ch07-receiving.md",
    "chapters/ch08-sending.md",
    "chapters/ch09-history.md",
    "chapters/ch10-contacts.md",
    "chapters/ch11-backup.md",
    "chapters/ch12-settings.md",
    "chapters/part3.md",
    "chapters/ch13-pocx-mining.md",
    "chapters/ch14-hardware.md",
    "chapters/ch15-mining-wizard.md",
    "chapters/ch16-plotting.md",
    "chapters/ch17-gpu-plotting.md",
    "chapters/ch18-managing-plots.md",
    "chapters/ch19-forging-assignments.md",
    "chapters/ch20-mining-dashboard.md",
    "chapters/ch21-multi-chain.md",
    "chapters/ch22-benchmarking.md",
    "chapters/part4.md",
    "chapters/ch23-android.md",
    "chapters/ch24-aggregator.md",
    "chapters/ch25-external-node.md",
    "chapters/ch25b-remote-node.md",
    "chapters/part5.md",
    "chapters/ch26-troubleshooting.md",
    "chapters/ch27-faq.md",
    "chapters/ch28-glossary.md",
    "chapters/ch29-help.md"
)

$missing = $inputs | Where-Object { -not (Test-Path $_) }
if ($missing) {
    Write-Error "Missing input file(s): $($missing -join ', ')"
}

if (-not (Get-Command pandoc -ErrorAction SilentlyContinue)) {
    Write-Error "pandoc was not found in PATH. Install it from https://pandoc.org/installing.html"
}

& pandoc $inputs `
    --output ../handbook.pdf `
    --pdf-engine=xelatex `
    --toc `
    --toc-depth=2 `
    --number-sections `
    --top-level-division=chapter `
    --resource-path=.

if ($LASTEXITCODE -ne 0) {
    Write-Error "pandoc exited with code $LASTEXITCODE"
}

Write-Host "Built ../handbook.pdf"
