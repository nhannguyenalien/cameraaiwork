# One-command installer for a site's on-premise Windows machine.
#
#   irm https://raw.githubusercontent.com/nhannguyenalien/cameraaiwork/main/apps/relay/install.ps1 | iex
#
# Windows equivalent of install.sh: clones the repo, downloads cloudflared
# + go2rtc for Windows, asks for the account API key + camera info,
# registers the site/camera with the backend, writes local config, and
# installs go2rtc + the relay as Windows Services (via node-windows, since
# there's no launchd/systemd on Windows). Must run as Administrator —
# installing a Windows Service requires it.

$ErrorActionPreference = "Stop"
# Invoke-WebRequest's default progress bar is extremely slow on Windows
# PowerShell 5.1 (a long-known bug) — this makes downloads fast.
$ProgressPreference = "SilentlyContinue"

$RepoUrl = if ($env:CAMERAAIWORK_REPO) { $env:CAMERAAIWORK_REPO } else { "https://github.com/nhannguyenalien/cameraaiwork.git" }
$InstallDir = if ($env:CAMERAAIWORK_DIR) { $env:CAMERAAIWORK_DIR } else { "$env:USERPROFILE\cameraaiwork" }
$ApiBase = if ($env:CAMERAAIWORK_API) { $env:CAMERAAIWORK_API } else { "https://cameraaiwork.pages.dev" }

Write-Host "=== cameraaiwork - cai dat on-site (Windows) ===" -ForegroundColor Cyan
Write-Host "Se cai vao: $InstallDir"
Write-Host "Backend: $ApiBase"
Write-Host ""

# --- 0. Must be Administrator (required to install a Windows Service) ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "!! Can chay PowerShell voi quyen Administrator (chuot phai -> Run as Administrator) roi chay lai." -ForegroundColor Red
    exit 1
}

# --- 1. Prerequisites ---
function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command "node")) {
    Write-Host "==> Node.js chua co, dang cai qua winget..."
    if (Test-Command "winget") {
        winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        Write-Host "!! Vua cai Node.js xong. Dong cua so PowerShell nay, mo lai (voi quyen Administrator) roi chay lai lenh cai dat." -ForegroundColor Yellow
        exit 0
    } else {
        Write-Host "!! Can cai Node.js truoc: https://nodejs.org" -ForegroundColor Red
        exit 1
    }
}
if (-not (Test-Command "git")) {
    Write-Host "==> Git chua co, dang cai qua winget..."
    if (Test-Command "winget") {
        winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
        Write-Host "!! Vua cai Git xong. Dong cua so PowerShell nay, mo lai (voi quyen Administrator) roi chay lai lenh cai dat." -ForegroundColor Yellow
        exit 0
    } else {
        Write-Host "!! Can cai Git truoc: https://git-scm.com" -ForegroundColor Red
        exit 1
    }
}

# --- 2. Get the code ---
if (Test-Path "$InstallDir\.git") {
    Write-Host "==> Cap nhat $InstallDir..."
    git -C $InstallDir pull --ff-only
} else {
    Write-Host "==> Tai cameraaiwork ve $InstallDir..."
    git clone --depth 1 $RepoUrl $InstallDir
}
Set-Location $InstallDir

# --- 3. Ask for account + camera info ---
Write-Host ""
$ApiKey = Read-Host "Dan API key account cua ban"
$SiteName = Read-Host "Ten dia diem (vd: Nha chinh)"
$CamIp = Read-Host "IP camera trong LAN"
$CamUser = Read-Host "Username ONVIF"
$CamPassSecure = Read-Host "Password ONVIF" -AsSecureString
$CamPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($CamPassSecure))
$CamOnvifPortInput = Read-Host "Cong ONVIF [2020]"
$CamOnvifPort = if ([string]::IsNullOrWhiteSpace($CamOnvifPortInput)) { 2020 } else { [int]$CamOnvifPortInput }

# --- 4. Register the site + camera with the backend ---
Write-Host ""
Write-Host "==> Dang ky site voi backend..."
$authHeader = @{ Authorization = "Bearer $ApiKey" }
$siteResp = Invoke-RestMethod -Uri "$ApiBase/api/sites" -Method Post -Headers $authHeader `
    -ContentType "application/json" -Body (@{ name = $SiteName } | ConvertTo-Json)
$SiteId = $siteResp.siteId
$RelaySecret = $siteResp.relaySecret
$TunnelToken = $siteResp.tunnelToken
Write-Host "    siteId = $SiteId"

Write-Host "==> Dang ky camera..."
Invoke-RestMethod -Uri "$ApiBase/api/sites/$SiteId/cameras" -Method Post -Headers $authHeader `
    -ContentType "application/json" -Body (@{ stream = "cam1"; name = $SiteName } | ConvertTo-Json) | Out-Null
Write-Host "    camera 'cam1' da dang ky"

# --- 5. Write local config (never committed — see .gitignore) ---
$camerasJson = @"
[
  {
    "id": "cam1",
    "stream": "cam1",
    "onvif": {
      "ip": "$CamIp",
      "port": $CamOnvifPort,
      "username": "$CamUser",
      "password": "$CamPass"
    }
  }
]
"@
# Write plain UTF-8 with no BOM — Set-Content's "UTF8" encoding adds a BOM
# on Windows PowerShell 5.1, which breaks Node's JSON.parse on cameras.json
# (a stray BOM byte before "[" isn't valid JSON).
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText("$InstallDir\apps\relay\cameras.json", $camerasJson, $Utf8NoBom)

$cloudflaredPath = "$InstallDir\infra\go2rtc\bin\cloudflared.exe"
$envContent = @"
SITE_ID=$SiteId
RELAY_PORT=4000
RELAY_SECRET=$RelaySecret
GO2RTC_URL=http://localhost:1984
PAGES_API_URL=$ApiBase
CLOUDFLARED_BIN=$cloudflaredPath
CLOUDFLARE_TUNNEL_TOKEN=$TunnelToken
"@
[System.IO.File]::WriteAllText("$InstallDir\apps\relay\.env", $envContent, $Utf8NoBom)

Write-Host "==> Da ghi apps\relay\cameras.json va apps\relay\.env"

# --- 6. Download go2rtc + cloudflared for Windows ---
$binDir = "infra\go2rtc\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

Write-Host "==> Tai go2rtc..."
$arch = $env:PROCESSOR_ARCHITECTURE
$go2rtcAsset = switch ($arch) {
    "ARM64" { "go2rtc_win_arm64.zip" }
    default { "go2rtc_win64.zip" }
}
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/AlexxIT/go2rtc/releases/latest"
$go2rtcUrl = ($release.assets | Where-Object { $_.name -eq $go2rtcAsset }).browser_download_url
Invoke-WebRequest -Uri $go2rtcUrl -OutFile "$binDir\go2rtc.zip"
Expand-Archive -Path "$binDir\go2rtc.zip" -DestinationPath $binDir -Force
Remove-Item "$binDir\go2rtc.zip"

Write-Host "==> Tai cloudflared..."
$cfAsset = switch ($arch) {
    "ARM64" { "cloudflared-windows-amd64.exe" } # cloudflared has no windows-arm64 build; amd64 runs fine under emulation
    default { "cloudflared-windows-amd64.exe" }
}
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/$cfAsset" -OutFile "$binDir\cloudflared.exe"

# --- 7. Render go2rtc.yaml from cameras.json ---
node infra\go2rtc\render-config.js

# --- 8. Install deps (including node-windows) ---
Push-Location apps\relay
npm install
Pop-Location

# --- 9. Install as Windows Services ---
Write-Host "==> Dang cai Windows Services..."
Push-Location apps\relay
node win\install-services.js
Pop-Location

Write-Host ""
Write-Host "OK Xong! Mo $ApiBase, dang nhap bang API key vua dung o tren." -ForegroundColor Green
Write-Host "   Camera + live view se xuat hien trong vong ~10-15 giay (cho tunnel len)."
Write-Host "   Go service: node apps\relay\win\uninstall-services.js (chay voi quyen Administrator)"
