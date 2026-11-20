[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient

$app = Get-Process -Name 'Pot Translate Next' -ErrorAction SilentlyContinue
if (-not $app) { throw 'Start the installed Pot Translate Next application before running this test.' }
if (@($app).Count -ne 1) { throw 'Expected exactly one running Pot Translate Next process.' }
$app = @($app)[0]
$root = [System.Windows.Automation.AutomationElement]::RootElement

function Get-TranslateWindows {
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $items = for ($i = 0; $i -lt $all.Count; $i++) {
        $window = $all.Item($i)
        if ($window.Current.ProcessId -eq $app.Id -and $window.Current.Name -eq 'Translate') { $window }
    }
    return @($items)
}

function Get-EditValues([System.Windows.Automation.AutomationElement]$Window) {
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Edit
    )
    $edits = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    $values = for ($i = 0; $i -lt $edits.Count; $i++) {
        $edit = $edits.Item($i)
        $pattern = $null
        if ($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
            [PSCustomObject]@{ Name = $edit.Current.Name; Value = $pattern.Current.Value }
        }
    }
    return @($values)
}

function Get-ControlNames([System.Windows.Automation.AutomationElement]$Window) {
    $all = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $names = for ($i = 0; $i -lt $all.Count; $i++) { $all.Item($i).Current.Name }
    return @($names)
}

function Close-TranslateWindows {
    $pattern = $null
    foreach ($window in @(Get-TranslateWindows)) {
        if ($window.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$pattern)) {
            $pattern.Close()
        }
    }
}

function Set-NativeSelection([int]$Id, [string]$Text, [string]$ControlFile) {
    $json = @{ id = $Id; text = $Text } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($ControlFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Wait-ForSource([string]$Text) {
    $deadline = [DateTime]::Now.AddSeconds(25)
    while ([DateTime]::Now -lt $deadline) {
        $windows = @(Get-TranslateWindows)
        if ($windows.Count -eq 1) {
            $edits = @(Get-EditValues $windows[0])
            $source = @($edits | Where-Object { $_.Name -eq '输入原文' -and $_.Value -eq $Text })
            if ($source.Count -eq 1) { return $windows[0] }
        }
        if (Test-Path ($control + '.error')) { throw (Get-Content ($control + '.error') -Raw) }
        if ($sourceProcess.HasExited) { throw "Native selection source exited early with code $($sourceProcess.ExitCode)." }
        Start-Sleep -Milliseconds 250
    }
    $windowNames = @(Get-TranslateWindows | ForEach-Object { $_.Current.Name })
    throw "Timed out waiting for native selected text in one legacy Translate window: $Text. Windows: $($windowNames -join ', ')"
}

$temp = $env:TEMP
$source = Join-Path $temp 'pot-selection-native-source.ps1'
$control = Join-Path $temp 'pot-selection-native-uia.json'
$sourceOutput = Join-Path $temp 'pot-selection-native-uia.out.log'
$sourceError = Join-Path $temp 'pot-selection-native-uia.err.log'
$sourceProcess = $null
$testFailed = $false
try {
    Close-TranslateWindows
    Copy-Item (Join-Path $PSScriptRoot 'selection-native-source.ps1') $source -Force
    Remove-Item $control, ($control + '.error'), $sourceOutput, $sourceError -ErrorAction SilentlyContinue
    $sourceProcess = Start-Process powershell.exe -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $source, '-ControlFile', $control
    ) -PassThru -RedirectStandardOutput $sourceOutput -RedirectStandardError $sourceError

    Set-NativeSelection 1 'First native selected paragraph.' $control
    $window = Wait-ForSource 'First native selected paragraph.'

    $deadline = [DateTime]::Now.AddSeconds(30)
    $translationReady = $false
    while ([DateTime]::Now -lt $deadline) {
        $edits = @(Get-EditValues $window)
        $translations = @($edits | Where-Object { $_.Name -ne '输入原文' -and -not [string]::IsNullOrWhiteSpace($_.Value) })
        if ($translations.Count -gt 0) { $translationReady = $true; break }
        Start-Sleep -Milliseconds 300
    }
    if (-not $translationReady) { throw 'The legacy window did not display a real translation.' }

    $names = @(Get-ControlNames $window)
    foreach ($required in @('常规翻译', '源语言', '目标语言')) {
        if ($names -notcontains $required) { throw "Missing legacy window control: $required" }
    }

    Set-NativeSelection 2 'Second native selected paragraph.' $control
    $secondWindow = Wait-ForSource 'Second native selected paragraph.'
    if (@(Get-TranslateWindows).Count -ne 1) { throw 'Expected exactly one legacy Translate window after repeated selection.' }
    if (Test-Path ($control + '.error')) { throw (Get-Content ($control + '.error') -Raw) }

    Write-Output 'Native selection passed: real Windows capture displayed source and real translation, exposed language and multi-service controls, and kept repeated selections in one legacy Translate window at a time.'
} catch {
    $testFailed = $true
    Write-Error $_
    if (Test-Path ($control + '.error')) { Write-Error (Get-Content ($control + '.error') -Raw) }
    if (Test-Path $sourceOutput) { Write-Output (Get-Content $sourceOutput -Raw) }
    if (Test-Path $sourceError) { Write-Error (Get-Content $sourceError -Raw) }
} finally {
    if ($sourceProcess) { Stop-Process -Id $sourceProcess.Id -Force -ErrorAction SilentlyContinue }
    Close-TranslateWindows
    Remove-Item $source, $control, ($control + '.error'), $sourceOutput, $sourceError -ErrorAction SilentlyContinue
}
if ($testFailed) { exit 1 }
exit 0
