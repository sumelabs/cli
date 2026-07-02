# Sume CLI installer for Windows PowerShell.
# Usage:
#   irm https://cli.sume.com/install.ps1 | iex
#
# Environment variables:
#   SUME_VERSION        Specific version to install, for example 0.1.6 or v0.1.6.
#                       Defaults to latest.
#   SUME_DIR            Installation root. Defaults to $HOME\.sume-com.
#   SUME_RELEASE_BASE   GitHub Releases base URL. Defaults to https://github.com/sumelabs/cli/releases.

$ErrorActionPreference = "Stop"

$BinaryName = "sume.exe"
$SumeDir = if ($env:SUME_DIR) { $env:SUME_DIR } else { Join-Path $HOME ".sume-com" }
$BinDir = Join-Path $SumeDir "bin"
$Version = if ($env:SUME_VERSION) { $env:SUME_VERSION } else { "latest" }
$ReleaseBase = if ($env:SUME_RELEASE_BASE) { $env:SUME_RELEASE_BASE.TrimEnd("/") } else { "https://github.com/sumelabs/cli/releases" }

function Write-Info($Message) {
  Write-Host $Message
}

function Write-Success($Message) {
  Write-Host $Message -ForegroundColor Green
}

function Write-Warn($Message) {
  Write-Warning $Message
}

function Fail($Message) {
  Write-Error $Message
  exit 1
}

function Normalize-Version($Value) {
  if ($Value -eq "latest") {
    return $Value
  }
  return $Value.TrimStart("v")
}

function Get-ManifestUrl($Value) {
  if ($Value -eq "latest") {
    return "$ReleaseBase/latest/download/manifest.json"
  }
  return "$ReleaseBase/download/v$Value/manifest.json"
}

function Get-PlatformArch {
  switch ($env:PROCESSOR_ARCHITECTURE) {
    "AMD64" { return "x64" }
    "ARM64" { return "arm64" }
    default { Fail "Unsupported Windows architecture: $env:PROCESSOR_ARCHITECTURE" }
  }
}

function Download-File($Url, $Output) {
  Invoke-WebRequest -Uri $Url -OutFile $Output -UseBasicParsing
}

function Verify-Checksum($Path, $Expected) {
  $Actual = (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected.ToLowerInvariant()) {
    Fail "Checksum verification failed for downloaded Sume CLI binary."
  }
}

$Version = Normalize-Version $Version
$PlatformArch = Get-PlatformArch
$AssetName = "sume-windows-$PlatformArch.exe"
$Manifest = Invoke-RestMethod -Uri (Get-ManifestUrl $Version)
$ResolvedVersion = $Manifest.version
$Asset = $Manifest.assets.PSObject.Properties[$AssetName].Value
if (-not $ResolvedVersion) {
  Fail "Release manifest did not include a version."
}
if (-not $Asset -or -not $Asset.url -or -not $Asset.sha256) {
  Fail "Release manifest did not include $AssetName."
}
$DownloadUrl = $Asset.url
$ExpectedChecksum = $Asset.sha256
$Target = Join-Path $BinDir $BinaryName
$Existing = Get-Command "sume" -ErrorAction SilentlyContinue
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
$TempBinary = Join-Path $TempDir $AssetName

try {
  Write-Info "Installing Sume CLI v$ResolvedVersion (windows-$PlatformArch)..."

  if ($Existing -and $Existing.Source -ne $Target) {
    Write-Warn "Found an existing sume at $($Existing.Source). This installer will not overwrite it."
  }

  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

  Download-File $DownloadUrl $TempBinary

  Verify-Checksum $TempBinary $ExpectedChecksum

  Copy-Item -Force $TempBinary $Target
  & $Target --version | Out-Null

  Write-Host ""
  Write-Success "Sume CLI installed at $Target"
  Write-Host ""

  $PathEntries = $env:PATH -split ";"
  if ($PathEntries -contains $BinDir) {
    Write-Info "Run 'sume login' to get started."
  } else {
    Write-Warn "Sume CLI is installed, but $BinDir is not on your PATH."
    Write-Host ""
    Write-Info "Run this once in the current PowerShell session:"
    Write-Host ""
    Write-Host "  `$env:PATH = `"$BinDir;`$env:PATH`""
    Write-Host ""
    Write-Info "To persist it for future sessions, add $BinDir to your user PATH."
  }
} finally {
  if (Test-Path $TempDir) {
    Remove-Item -Recurse -Force $TempDir
  }
}
