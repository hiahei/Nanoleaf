$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
& (Join-Path $PSScriptRoot 'launch-nanoleaf.ps1')
