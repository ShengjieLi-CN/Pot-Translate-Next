param([Parameter(Mandatory = $true)][string]$MsiDirectory, [string]$ExpectedVersion = '3.0.7')
$ErrorActionPreference = 'Stop'
$installer = New-Object -ComObject WindowsInstaller.Installer
$results = @()
foreach ($package in Get-ChildItem -LiteralPath $MsiDirectory -Filter "*_${ExpectedVersion}_*.msi") {
    $database = $installer.OpenDatabase($package.FullName, 0)
    $view = $database.OpenView('SELECT `Property`, `Value` FROM `Property`')
    $view.Execute()
    $properties = @{}
    while ($record = $view.Fetch()) {
        $properties[$record.StringData(1)] = $record.StringData(2)
    }
    $view.Close()
    $fileView = $database.OpenView('SELECT `FileName`, `FileSize` FROM `File`')
    $fileView.Execute()
    $files = @()
    while ($record = $fileView.Fetch()) {
        $files += @{ name = $record.StringData(1); bytes = $record.IntegerData(2) }
    }
    $fileView.Close()
    $template = $database.SummaryInformation(0).Property(7)
    if ($properties.ProductName -ne 'Pot Translate Next') { throw 'Unexpected product name' }
    if ($properties.ProductVersion -ne $ExpectedVersion) { throw 'Unexpected product version' }
    if ($template -notlike 'x64;*') { throw 'Unexpected architecture' }
    if ($properties.ProductLanguage -notin @('2052', '1033')) { throw 'Unexpected language' }
    if (-not ($files | Where-Object { $_.name -match '\.exe$' -and $_.bytes -gt 1000000 })) { throw 'Missing application executable' }
    $results += @{
        file = $package.Name
        bytes = $package.Length
        product = $properties.ProductName
        version = $properties.ProductVersion
        language = $properties.ProductLanguage
        template = $template
        embeddedFiles = $files
        sha256 = (Get-FileHash -LiteralPath $package.FullName -Algorithm SHA256).Hash
    }
}
if ($results.Count -ne 2) { throw 'Expected both Chinese and English MSI packages' }
$results | ConvertTo-Json -Depth 5
