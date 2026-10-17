param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolchain = 'stable-x86_64-pc-windows-msvc'
$rustupPath = Join-Path $env:USERPROFILE '.cargo/bin/rustup.exe'
$cargoPath = & $rustupPath which --toolchain $toolchain cargo
if ($LASTEXITCODE -ne 0) { throw 'Install the MSVC Rust toolchain before building.' }
$previousPath = $env:PATH
$previousToolchain = $env:RUSTUP_TOOLCHAIN
$manifestPath = Join-Path $projectRoot 'src-tauri/Cargo.toml'
$previousManifest = [IO.File]::ReadAllBytes($manifestPath)
try {
    $env:PATH = (Split-Path -Parent $cargoPath) + ';' + $env:PATH
    $env:RUSTUP_TOOLCHAIN = $toolchain
    Push-Location -LiteralPath $projectRoot
    try {
        & node 'node_modules/@tauri-apps/cli/tauri.js' build --target x86_64-pc-windows-msvc --bundles none --config 'src-tauri/tauri.local.conf.json' --ci -- --locked
        if ($LASTEXITCODE -ne 0) { throw "Local build failed with exit code $LASTEXITCODE." }
    } finally { Pop-Location }
} finally {
    [IO.File]::WriteAllBytes($manifestPath, $previousManifest)
    $env:PATH = $previousPath
    $env:RUSTUP_TOOLCHAIN = $previousToolchain
}
