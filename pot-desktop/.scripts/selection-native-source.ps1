# Synthetic native text source for verify-selection-native.cjs. No user documents.
param([Parameter(Mandatory=$true)][string]$ControlFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class SelectionSource { [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra); [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }'
[SelectionSource]::SetProcessDPIAware() | Out-Null
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Pot native selection test source'
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(40,40)
$form.Size = New-Object System.Drawing.Size(700,500)
$editor = New-Object System.Windows.Forms.TextBox
$editor.Multiline = $true
$editor.Dock = 'Fill'
$editor.Font = New-Object System.Drawing.Font('Arial',18)
$form.Controls.Add($editor)
$script:last = ''
$script:pending = $null
$script:readyAt = [DateTime]::MaxValue
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.Add_Tick({
    try {
        if (Test-Path -LiteralPath $ControlFile) {
            $value = [IO.File]::ReadAllText($ControlFile)
            if ($value -and $value -ne $script:last) {
                $request = $value | ConvertFrom-Json
                $script:last = $value
                $script:pending = $request
                $editor.Text = $request.text
                $form.TopMost = $true
                $form.Activate()
                [SelectionSource]::SetForegroundWindow($form.Handle) | Out-Null
                [System.Windows.Forms.Cursor]::Position = $editor.PointToScreen((New-Object System.Drawing.Point(20,40)))
                [SelectionSource]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
                [SelectionSource]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
                $editor.Focus() | Out-Null
                $editor.SelectAll()
                $form.TopMost = $false
                $script:readyAt = [DateTime]::Now.AddMilliseconds(350)
            }
        }
        if ($script:pending -and [DateTime]::Now -ge $script:readyAt) {
            if ([SelectionSource]::GetForegroundWindow() -ne $form.Handle) { throw 'Native test source did not receive foreground focus.' }
            $editor.Text = $script:pending.text
            $editor.Focus() | Out-Null
            $editor.SelectAll()
            if ($editor.SelectedText -ne $script:pending.text) { throw 'Native fixture selection was lost.' }
            $script:pending = $null
            $script:requestTask = $client.GetAsync('http://127.0.0.1:60828/selection_translate')
        }
    } catch {
        [IO.File]::WriteAllText($ControlFile + '.error', $_.Exception.Message)
        $script:pending = $null
    }
})
$timer.Start()
try { [System.Windows.Forms.Application]::Run($form) }
finally { $timer.Dispose(); $client.Dispose(); $form.Dispose() }
