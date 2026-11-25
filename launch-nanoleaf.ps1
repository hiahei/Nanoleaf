$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$localUrl = 'http://127.0.0.1:4177'
$portableNode = Join-Path $PSScriptRoot 'tools\node\node.exe'
$dataRoot = Join-Path $PSScriptRoot 'data'
$outputLog = Join-Path $dataRoot 'nanoleaf-service.log'
$errorLog = Join-Path $dataRoot 'nanoleaf-service-error.log'

function Test-NanoleafService {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$localUrl/api/config" -TimeoutSec 1
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

try {
    if (-not (Test-NanoleafService)) {
        if (-not (Test-Path -LiteralPath $portableNode)) {
            throw "Portable Node.js was not found at $portableNode"
        }

        New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
        $env:NANOLEAF_HOST = '0.0.0.0'
        $env:NANOLEAF_PORT = '4177'
        $env:NANOLEAF_OPEN_BROWSER = '0'
        Remove-Item Env:NANOLEAF_LAN -ErrorAction SilentlyContinue

        $service = Start-Process `
            -FilePath $portableNode `
            -ArgumentList 'server.js' `
            -WorkingDirectory $PSScriptRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput $outputLog `
            -RedirectStandardError $errorLog `
            -PassThru

        $ready = $false
        for ($attempt = 0; $attempt -lt 25; $attempt += 1) {
            Start-Sleep -Milliseconds 200
            if (Test-NanoleafService) {
                $ready = $true
                break
            }
            if ($service.HasExited) { break }
        }
        if (-not $ready) {
            throw "Nanoleaf did not start. See $errorLog"
        }
    }

    Start-Process $localUrl
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        $_.Exception.Message,
        'Nanoleaf startup failed',
        [System.Windows.MessageBoxButton]::OK,
        [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
    exit 1
}
