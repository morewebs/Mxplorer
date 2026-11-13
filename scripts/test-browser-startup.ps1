[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $Binary,
    [ValidateRange(1, 60)]
    [int] $WaitSeconds = 12,
    [string] $ArtifactDirectory = $(if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP })
)

$ErrorActionPreference = 'Stop'
$binaryPath = (Resolve-Path -LiteralPath $Binary).Path
$logDirectory = Join-Path $ArtifactDirectory "mxplorer-startup-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$stdoutPath = Join-Path $logDirectory 'stdout.log'
$stderrPath = Join-Path $logDirectory 'stderr.log'
$fatalPattern = 'panicked at|panic in a function|thread caused non-unwinding panic|fatal runtime error|state\(\) called before manage\(\)'
$browserProcess = $null

try {
    # Exercise the real main entry point and embedded frontend. Cookie smoke does
    # not create browser chrome and cannot catch IPC reentrancy during setup.
    $browserProcess = Start-Process -FilePath $binaryPath -WorkingDirectory (Split-Path -Parent $binaryPath) -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
    do {
        Start-Sleep -Milliseconds 250
        $browserProcess.Refresh()
        $stderr = [string](Get-Content -LiteralPath $stderrPath -Raw)
        if ($stderr -match $fatalPattern) {
            throw "Browser startup emitted a panic or fatal error. stderr: $stderrPath`n$($stderr.Substring(0, [Math]::Min(1500, $stderr.Length)))"
        }
        if ($browserProcess.HasExited) {
            throw "Browser exited during startup with code $($browserProcess.ExitCode). stderr: $stderrPath"
        }
    } while ([DateTime]::UtcNow -lt $deadline)
}
finally {
    # Only close the process created by this test; preserve existing browser
    # processes and all profile data. WER can keep an aborted process alive.
    if ($null -ne $browserProcess) {
        $browserProcess.Refresh()
        if (-not $browserProcess.HasExited) {
            $null = $browserProcess.CloseMainWindow()
            if (-not $browserProcess.WaitForExit(3000)) {
                Stop-Process -InputObject $browserProcess -Force
                if (-not $browserProcess.WaitForExit(5000)) {
                    throw "Startup test could not stop its browser PID $($browserProcess.Id)"
                }
            }
        }
        $browserProcess.Dispose()
    }
}

Write-Output "Browser stayed alive for $WaitSeconds seconds without a panic. Logs: $logDirectory"
