# Install sume, the Sume API CLI, on Windows.
#
#   irm https://raw.githubusercontent.com/sumelabs/cli/main/install.ps1 | iex
#
# Settings (environment variables):
#   SUME_CLI_VERSION          a release like 0.1.0 (default: the latest)
#   SUME_CLI_INSTALL_DIR      where the binary goes (default: %LOCALAPPDATA%\sume\bin)
#   SUME_CLI_NO_MODIFY_PATH   set to 1 to leave your PATH alone
#
# The download is checked against the release's checksums.txt (SHA-256)
# before anything is installed. Works in Windows PowerShell 5.1 and PowerShell 7.

# Run in a child scope so `irm | iex` leaves nothing behind in your session.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  # Windows PowerShell 5.1 may default to TLS 1.0, which GitHub refuses.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $Repo = 'sumelabs/cli'
  $InstallDir = if ($env:SUME_CLI_INSTALL_DIR) { $env:SUME_CLI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'sume\bin' }

  if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'sume needs 64-bit Windows.'
  }

  if ($env:SUME_CLI_VERSION) {
    $Version = $env:SUME_CLI_VERSION.TrimStart('v')
  } else {
    $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'sume-install' }
    $Version = $Release.tag_name.TrimStart('v')
  }
  if ($Version -notmatch '^\d+\.\d+\.\d+') { throw "No published release found at https://github.com/$Repo/releases" }

  # Windows on Arm runs the x64 build through emulation.
  $Asset = 'sume-windows-x64.exe'
  $Base = "https://github.com/$Repo/releases/download/v$Version"
  $Temp = Join-Path ([IO.Path]::GetTempPath()) ('sume-' + [Guid]::NewGuid())
  New-Item -ItemType Directory -Path $Temp | Out-Null

  try {
    Write-Host "Downloading sume $Version (windows x64)..."
    Invoke-WebRequest -Uri "$Base/$Asset" -OutFile (Join-Path $Temp $Asset) -UseBasicParsing
    Invoke-WebRequest -Uri "$Base/checksums.txt" -OutFile (Join-Path $Temp 'checksums.txt') -UseBasicParsing

    $Expected = $null
    foreach ($Line in Get-Content (Join-Path $Temp 'checksums.txt')) {
      if ($Line -match '^([0-9a-fA-F]{64})\s+\*?(\S+)$' -and $Matches[2] -eq $Asset) {
        $Expected = $Matches[1].ToLower()
        break
      }
    }
    if (-not $Expected) { throw "checksums.txt has no entry for $Asset" }
    $Actual = (Get-FileHash -Algorithm SHA256 (Join-Path $Temp $Asset)).Hash.ToLower()
    if ($Expected -ne $Actual) { throw "Checksum mismatch for $Asset; nothing was installed." }

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $Target = Join-Path $InstallDir 'sume.exe'
    $Old = "$Target.old"
    if (Test-Path $Old) { Remove-Item -Force $Old -ErrorAction SilentlyContinue }
    if (Test-Path $Target) {
      # A running sume.exe cannot be overwritten, but it can be renamed.
      Move-Item -Force $Target $Old
    }
    try {
      Move-Item -Force (Join-Path $Temp $Asset) $Target
    } catch {
      if (Test-Path $Old) { Move-Item -Force $Old $Target }
      throw
    }
    Write-Host "Installed sume $Version to $Target" -ForegroundColor Green
  } finally {
    Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue
  }

  if ($env:SUME_CLI_NO_MODIFY_PATH -eq '1') {
    Write-Host "Add $InstallDir to your PATH to run sume from anywhere."
  } else {
    # Edit the raw registry value so entries like %USERPROFILE%\bin stay unexpanded.
    $Key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    try {
      $UserPath = [string]$Key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if (-not (($UserPath -split ';') -contains $InstallDir)) {
        $NewPath = if ($UserPath) { "$($UserPath.TrimEnd(';'));$InstallDir" } else { $InstallDir }
        $Key.SetValue('Path', $NewPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
        # Setting any user variable through .NET tells open programs the environment changed.
        [Environment]::SetEnvironmentVariable('SUME_CLI_PATH_REFRESH', '1', 'User')
        [Environment]::SetEnvironmentVariable('SUME_CLI_PATH_REFRESH', $null, 'User')
        Write-Host "Added $InstallDir to your PATH. Open a new terminal to use it everywhere."
      }
    } finally {
      $Key.Close()
    }
    if (-not (($env:Path -split ';') -contains $InstallDir)) { $env:Path = "$env:Path;$InstallDir" }
  }

  Write-Host ''
  Write-Host 'Next:'
  Write-Host '  $env:SUME_API_KEY = "..."   # a person makes it at https://www.sume.com/dashboard/api-keys (or put it in .\.env)'
  Write-Host '  sume init               # tell this project''s coding agents about sume'
  Write-Host '  sume run gpt-image-2 "a ceramic cup on a wooden table" -q low'
}
