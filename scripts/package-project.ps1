param([string]$Destination = (Join-Path $PSScriptRoot '..\secure-terminal-project.zip'))
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Destination = [System.IO.Path]::GetFullPath($Destination)
$skip = '(\\|/)(\.git|node_modules|logs)(\\|/)|(\\|/)\.env($|\.)|secure-terminal-project\.zip$'
$files = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.FullName -notmatch $skip }
if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = $null
try {
  $zip = [System.IO.Compression.ZipFile]::Open($Destination, [System.IO.Compression.ZipArchiveMode]::Create)
  foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
    $entry = $zip.CreateEntry($relativePath, [System.IO.Compression.CompressionLevel]::Optimal)
    $input = [System.IO.File]::OpenRead($file.FullName)
    $output = $entry.Open()
    try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
  }
} finally { if ($null -ne $zip) { $zip.Dispose() } }
Write-Output "Created shareable archive with preserved paths: $Destination"
