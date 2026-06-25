$ErrorActionPreference = "Stop"

$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$hostAddress = [System.Net.IPAddress]::Parse("127.0.0.1")
$port = 8765
$listener = $null

while ($true) {
  try {
    $listener = [System.Net.Sockets.TcpListener]::new($hostAddress, $port)
    $listener.Start()
    break
  }
  catch {
    $port += 1
    if ($port -gt 8799) { throw }
  }
}

$url = "http://127.0.0.1:$port/"
if ($env:EXAMENESPDF_NO_OPEN -ne "1") {
  try {
    Start-Process $url
  }
  catch {
    Write-Host "No se pudo abrir el navegador automaticamente."
    Write-Host "Abre manualmente esta direccion: $url"
  }
}

Write-Host ""
Write-Host "Aplicacion iniciada en $url"
Write-Host "Cierra esta ventana para detener el servidor local."
Write-Host ""

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".mjs" = "text/javascript; charset=utf-8"
  ".wasm" = "application/wasm"
  ".gz" = "application/gzip"
  ".pdf" = "application/pdf"
  ".txt" = "text/plain; charset=utf-8"
  ".csv" = "text/csv; charset=utf-8"
}

function Write-Response {
  param (
    [System.Net.Sockets.NetworkStream]$Stream,
    [int]$StatusCode,
    [string]$StatusText,
    [byte[]]$Body,
    [string]$ContentType = "text/plain; charset=utf-8",
    [bool]$HeadOnly = $false
  )

  if ($null -eq $Body) { $Body = [byte[]]::new(0) }
  $headers = @(
    "HTTP/1.1 $StatusCode $StatusText",
    "Content-Type: $ContentType",
    "Content-Length: $($Body.Length)",
    "Cache-Control: no-store",
    "Connection: close",
    "",
    ""
  ) -join "`r`n"

  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $HeadOnly -and $Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
}

function Resolve-RequestPath {
  param ([string]$RawTarget)

  $target = ($RawTarget -split "\?")[0]
  $target = [System.Uri]::UnescapeDataString($target.TrimStart("/"))
  if ([string]::IsNullOrWhiteSpace($target)) { $target = "index.html" }
  $target = $target -replace "/", [System.IO.Path]::DirectorySeparatorChar

  $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $target))
  $insideRoot = $fullPath -eq $root -or $fullPath.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar)
  if (-not $insideRoot) { return $null }
  return $fullPath
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 10000
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()

      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        $client.Close()
        continue
      }

      while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq "") { break }
      }

      $parts = $requestLine.Split(" ")
      $method = $parts[0]
      $target = $parts[1]
      $headOnly = $method -eq "HEAD"

      if ($method -ne "GET" -and $method -ne "HEAD") {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Metodo no permitido.")
        Write-Response -Stream $stream -StatusCode 405 -StatusText "Method Not Allowed" -Body $body -HeadOnly $headOnly
        continue
      }

      $resolvedPath = Resolve-RequestPath $target
      if ($null -eq $resolvedPath) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Acceso denegado.")
        Write-Response -Stream $stream -StatusCode 403 -StatusText "Forbidden" -Body $body -HeadOnly $headOnly
        continue
      }

      if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Archivo no encontrado.")
        Write-Response -Stream $stream -StatusCode 404 -StatusText "Not Found" -Body $body -HeadOnly $headOnly
        continue
      }

      $bytes = [System.IO.File]::ReadAllBytes($resolvedPath)
      $ext = [System.IO.Path]::GetExtension($resolvedPath).ToLowerInvariant()
      $contentType = $types[$ext]
      if (-not $contentType) { $contentType = "application/octet-stream" }
      Write-Response -Stream $stream -StatusCode 200 -StatusText "OK" -Body $bytes -ContentType $contentType -HeadOnly $headOnly
    }
    catch {
      try {
        $message = [System.Text.Encoding]::UTF8.GetBytes("Error interno: $($_.Exception.Message)")
        Write-Response -Stream $stream -StatusCode 500 -StatusText "Internal Server Error" -Body $message
      }
      catch {}
    }
    finally {
      if ($reader) { $reader.Dispose() }
      if ($client) { $client.Close() }
    }
  }
}
finally {
  if ($listener) { $listener.Stop() }
}
