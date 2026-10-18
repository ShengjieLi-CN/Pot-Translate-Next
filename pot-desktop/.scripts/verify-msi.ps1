param([string]$Version = '3.2.1')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$bundleDir = Join-Path $repoRoot 'pot-desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi'
$releaseDir = Join-Path $repoRoot 'release'
$builtExe = Join-Path $repoRoot 'pot-desktop/src-tauri/target/x86_64-pc-windows-msvc/release/Pot Translate Next.exe'
$source = Join-Path $bundleDir "Pot Translate Next_${Version}_x64_zh-CN.msi"
$name = "Pot.Translate.Next_${Version}_x64_zh-CN.msi"
$output = Join-Path $releaseDir $name
$installer = New-Object -ComObject WindowsInstaller.Installer

function Read-MsiProperty($Database, [string]$Name) {
    $view = $Database.OpenView('SELECT `Value` FROM `Property` WHERE `Property` = ''' + $Name + '''')
    [void]$view.Execute()
    $record = $view.Fetch()
    $value = if ($record) { $record.StringData(1) } else { $null }
    [void]$view.Close()
    return $value
}

if ((Get-Item -LiteralPath $builtExe).VersionInfo.ProductVersion -ne $Version) { throw 'Executable version mismatch.' }
Copy-Item -LiteralPath $source -Destination $output -Force
$database = $installer.OpenDatabase($output, 0)
$product = Read-MsiProperty $database 'ProductName'
$productVersion = Read-MsiProperty $database 'ProductVersion'
$language = Read-MsiProperty $database 'ProductLanguage'
$upgradeCode = Read-MsiProperty $database 'UpgradeCode'
$template = $database.SummaryInformation(0).Property(7)
if ($product -ne 'Pot Translate Next' -or $productVersion -ne $Version -or $language -ne '2052' -or $template -notlike 'x64;*') { throw 'MSI product/version/language/architecture mismatch.' }
$previous = Join-Path $releaseDir 'Pot Translate Next_3.1.0_x64_zh-CN.msi'
if (Test-Path -LiteralPath $previous) {
    $oldDatabase = $installer.OpenDatabase($previous, 0)
    $previousUpgradeCode = Read-MsiProperty $oldDatabase 'UpgradeCode'
    if (-not [string]::Equals([string]$previousUpgradeCode, [string]$upgradeCode, [StringComparison]::OrdinalIgnoreCase)) { throw "MSI upgrade identity mismatch: previous=$previousUpgradeCode current=$upgradeCode" }
}
$view = $database.OpenView('SELECT `FileName`, `FileSize` FROM `File`')
[void]$view.Execute()
$files = @()
while ($record = $view.Fetch()) { $files += @{ name = $record.StringData(1); bytes = $record.IntegerData(2) } }
[void]$view.Close()

# Administrative extraction verifies the embedded executable without installing
# the app or replacing the user's running local version.
$taskCheckRoot = Join-Path $repoRoot ".work/msi-${Version}"
New-Item -ItemType Directory -Force -Path $taskCheckRoot | Out-Null
$extractDir = Join-Path $taskCheckRoot ('extract-' + [Guid]::NewGuid().ToString('N'))
$logPath = Join-Path $taskCheckRoot 'admin-extract.log'
$arguments = '/a "{0}" /qn REBOOT=ReallySuppress TARGETDIR="{1}" /L*v "{2}"' -f $output, $extractDir, $logPath
$taskExtract = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
if ($taskExtract.ExitCode -ne 0) { throw "Administrative extraction failed: $($taskExtract.ExitCode). See $logPath" }
$extracted = @(Get-ChildItem -LiteralPath $extractDir -Recurse -File -Filter 'Pot Translate Next.exe')
if ($extracted.Count -ne 1) { throw 'Expected one extracted application executable.' }
$exeHash = (Get-FileHash -LiteralPath $builtExe -Algorithm SHA256).Hash
if ((Get-FileHash -LiteralPath $extracted[0].FullName -Algorithm SHA256).Hash -ne $exeHash) { throw 'Embedded executable differs from the verified build.' }
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash
$report = [ordered]@{ file = $name; version = $productVersion; product = $product; language = $language; template = $template; upgradeCode = $upgradeCode; productCode = (Read-MsiProperty $database 'ProductCode'); bytes = (Get-Item -LiteralPath $output).Length; sha256 = $hash; embeddedExeSha256 = $exeHash; embeddedFiles = $files }
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $releaseDir "verification-${Version}.json") -Encoding utf8
"$hash  $name" | Set-Content -LiteralPath (Join-Path $releaseDir "SHA256SUMS-${Version}.txt") -Encoding ascii
$report | ConvertTo-Json -Depth 6
