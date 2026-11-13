param([Parameter(Mandatory=$true)][string]$Expected, [Parameter(Mandatory=$true)][string]$Actual, [Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Read-Package([string]$Path) {
  $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $hashes = @{}
    foreach ($entry in $archive.Entries) {
      if ($entry.FullName.EndsWith('/')) { continue }
      if ($hashes.ContainsKey($entry.FullName)) { throw "Duplicate package entry: $($entry.FullName)" }
      $stream = $entry.Open()
      $hasher = [System.Security.Cryptography.SHA256]::Create()
      try { $hashes[$entry.FullName] = [System.BitConverter]::ToString($hasher.ComputeHash($stream)) }
      finally { $stream.Dispose(); $hasher.Dispose() }
    }
    $nuspec = @($archive.Entries | Where-Object { $_.FullName.EndsWith('.nuspec') })
    if ($nuspec.Count -ne 1) { throw 'Expected one package nuspec' }
    $reader = [System.IO.StreamReader]::new($nuspec[0].Open())
    try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($manifest.package.metadata.version -ne $Version) { throw "Package version differs from $Version" }
    return $hashes
  } finally { $archive.Dispose() }
}
$expectedContents = Read-Package $Expected
$actualContents = Read-Package $Actual
if ($expectedContents.Count -ne $actualContents.Count) { throw 'Package content count differs' }
foreach ($name in $expectedContents.Keys) {
  if ($expectedContents[$name] -ne $actualContents[$name]) { throw "Package content differs: $name" }
}
Write-Output "Reconstructed package contents and version $Version verified."
