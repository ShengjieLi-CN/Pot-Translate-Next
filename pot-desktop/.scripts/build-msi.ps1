param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolchain = 'stable-x86_64-pc-windows-msvc'
$rustupPath = Join-Path $env:USERPROFILE '.cargo\bin\rustup.exe'

if ($env:OS -ne 'Windows_NT') {
    throw 'MSI packaging requires Windows.'
}
if (-not (Test-Path -LiteralPath $rustupPath)) {
    throw 'Install Rust with rustup before running this script.'
}
$vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswherePath)) {
    throw 'Install Visual Studio C++ Build Tools and the Windows SDK first.'
}
$visualStudioPath = & $vswherePath -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $visualStudioPath) {
    throw 'Visual Studio C++ Build Tools are missing or their installation has not completed.'
}

$cargoPath = & $rustupPath which --toolchain $toolchain cargo
if ($LASTEXITCODE -ne 0) {
    throw "Install the MSVC toolchain first: rustup toolchain install $toolchain --profile minimal --component rustfmt"
}
if (-not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $cargoPath) 'rustfmt.exe'))) {
    throw "The WebView2 build requires rustfmt: rustup component add rustfmt --toolchain $toolchain"
}

# Select MSVC for this build without changing the user's global Rust default.
$previousPath = $env:PATH
$previousToolchain = $env:RUSTUP_TOOLCHAIN
$previousGitFetch = $env:CARGO_NET_GIT_FETCH_WITH_CLI
$manifestPath = Join-Path $projectRoot 'src-tauri\Cargo.toml'
$previousManifest = [System.IO.File]::ReadAllBytes($manifestPath)
try {
    $env:PATH = (Split-Path -Parent $cargoPath) + ';' + $env:PATH
    $env:RUSTUP_TOOLCHAIN = $toolchain
    $env:CARGO_NET_GIT_FETCH_WITH_CLI = 'true'
    Push-Location -LiteralPath $projectRoot
    try {
        & node 'node_modules/@tauri-apps/cli/tauri.js' build `
            --target x86_64-pc-windows-msvc `
            --bundles msi `
            --config 'src-tauri/tauri.msi.conf.json' `
            --ci -- --locked
        if ($LASTEXITCODE -ne 0) {
            throw "MSI build failed with exit code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }
} finally {
    # Tauri 1 rewrites dependency features to match the merged configuration.
    [System.IO.File]::WriteAllBytes($manifestPath, $previousManifest)
    $env:PATH = $previousPath
    $env:RUSTUP_TOOLCHAIN = $previousToolchain
    $env:CARGO_NET_GIT_FETCH_WITH_CLI = $previousGitFetch
}
