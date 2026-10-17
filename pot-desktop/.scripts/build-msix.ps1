param(
    [string]$Version = '3.2.0',
    [string]$Publisher = 'CN=Shengjie Li'
)
$ErrorActionPreference = 'Stop'

# MSIX packaging for Pot Translate Next (Win32 desktop app, runFullTrust)
# Requires: Windows SDK makeappx.exe + signtool.exe, a release build of the app.

$projectRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $projectRoot
$releaseDir = Join-Path $repoRoot 'release'
$exePath = Join-Path $projectRoot 'src-tauri\target\x86_64-pc-windows-msvc\release\Pot Translate Next.exe'
$layoutDir = Join-Path $env:TEMP 'pot-msix-layout'
$outMsix = Join-Path $releaseDir "Pot Translate Next_${Version}_x64.msix"
$cerPath = Join-Path $releaseDir 'pot-msix-signing.cer'

$sdkBin = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64'
$makeappx = Join-Path $sdkBin 'makeappx.exe'
$signtool = Join-Path $sdkBin 'signtool.exe'
foreach ($tool in @($makeappx, $signtool)) {
    if (-not (Test-Path $tool)) { throw "Required tool not found: $tool" }
}
if (-not (Test-Path $exePath)) { throw "Release exe not found: $exePath. Run .scripts\build-local.ps1 first." }

if (-not (Test-Path $releaseDir)) { New-Item -ItemType Directory -Path $releaseDir | Out-Null }

# 1. Build package layout
if (Test-Path $layoutDir) { Remove-Item -Recurse -Force $layoutDir }
New-Item -ItemType Directory -Path $layoutDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $layoutDir 'Assets') | Out-Null

Copy-Item -LiteralPath $exePath -Destination $layoutDir
foreach ($icon in @('Square44x44Logo.png', 'Square150x150Logo.png', 'StoreLogo.png')) {
    Copy-Item (Join-Path $projectRoot "src-tauri\icons\$icon") -Destination (Join-Path $layoutDir 'Assets')
}
$runtimeRes = Join-Path $projectRoot 'src-tauri\target\x86_64-pc-windows-msvc\release\resources'
if (Test-Path $runtimeRes) {
    New-Item -ItemType Directory -Path (Join-Path $layoutDir 'resources') | Out-Null
    Copy-Item (Join-Path $runtimeRes '*') -Destination (Join-Path $layoutDir 'resources') -Recurse
}

# 2. AppxManifest.xml
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="PotTranslateNext" Publisher="$Publisher" Version="${Version}.0" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Pot Translate Next</DisplayName>
    <PublisherDisplayName>ShengjieLi-CN</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="zh-CN" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
  <Applications>
    <Application Id="PotTranslateNext" Executable="Pot Translate Next.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Pot Translate Next"
        Description="Bilingual sentence-aligned translation desktop app with input, screenshot and selection translation."
        BackgroundColor="#1F2430"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png" />
    </Application>
  </Applications>
</Package>
"@
[IO.File]::WriteAllText((Join-Path $layoutDir 'AppxManifest.xml'), $manifest)

# 3. Pack
& $makeappx pack /o /d "$layoutDir" /p "$outMsix" /v | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makeappx failed with exit code $LASTEXITCODE." }

# 4. Get or create signing certificate (kept in CurrentUser\My store, never written to repo)
$cert = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq $Publisher -and $_.FriendlyName -eq 'Pot Translate Next MSIX Signing' } |
    Select-Object -First 1
if (-not $cert) {
    $cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher -KeyUsage DigitalSignature `
        -FriendlyName 'Pot Translate Next MSIX Signing' -CertStoreLocation 'Cert:\CurrentUser\My' `
        -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
    Write-Host "Created new self-signed certificate: $($cert.Thumbprint)"
}
Export-Certificate -Cert $cert -FilePath $cerPath -Force | Out-Null

# 5. Sign
& $signtool sign /fd SHA256 /sha1 $cert.Thumbprint "$outMsix"
if ($LASTEXITCODE -ne 0) { throw "signtool failed with exit code $LASTEXITCODE." }

Write-Host ""
Write-Host "MSIX package created and signed:"
Write-Host "  $outMsix"
Write-Host "Public certificate (needed to trust the package on install):"
Write-Host "  $cerPath"
Write-Host "Certificate thumbprint: $($cert.Thumbprint)"
