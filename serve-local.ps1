param(
  [int] $Port = 4173
)

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootFull = [System.IO.Path]::GetFullPath($Root)
$MimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".svg" = "image/svg+xml"
}

function Send-Response {
  param(
    [System.Net.Sockets.NetworkStream] $Stream,
    [string] $Status,
    [byte[]] $Body,
    [string] $ContentType
  )

  $Header = "HTTP/1.1 $Status`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
  $HeaderBytes = [System.Text.Encoding]::ASCII.GetBytes($Header)
  $Stream.Write($HeaderBytes, 0, $HeaderBytes.Length)
  $Stream.Write($Body, 0, $Body.Length)
}

$Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$Listener.Start()
Write-Host "Schogge läuft auf http://127.0.0.1:$Port/"
Write-Host "Zum Beenden dieses Fenster schließen oder Strg+C drücken."

try {
  while ($true) {
    $Client = $Listener.AcceptTcpClient()
    try {
      $Stream = $Client.GetStream()
      $Buffer = New-Object byte[] 8192
      $Read = $Stream.Read($Buffer, 0, $Buffer.Length)
      if ($Read -le 0) {
        continue
      }

      $Request = [System.Text.Encoding]::ASCII.GetString($Buffer, 0, $Read)
      $FirstLine = ($Request -split "`r?`n")[0]
      $Parts = $FirstLine.Split(" ")
      if ($Parts.Length -lt 2) {
        continue
      }

      $Path = $Parts[1].Split("?")[0]
      if ($Path -eq "/") {
        $Path = "/index.html"
      }

      $Relative = [System.Uri]::UnescapeDataString($Path.TrimStart("/")).Replace("/", [System.IO.Path]::DirectorySeparatorChar)
      $FullPath = [System.IO.Path]::GetFullPath((Join-Path $RootFull $Relative))

      if (-not $FullPath.StartsWith($RootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        $Body = [System.Text.Encoding]::UTF8.GetBytes("403")
        Send-Response $Stream "403 Forbidden" $Body "text/plain; charset=utf-8"
        continue
      }

      if (-not [System.IO.File]::Exists($FullPath)) {
        $Body = [System.Text.Encoding]::UTF8.GetBytes("404")
        Send-Response $Stream "404 Not Found" $Body "text/plain; charset=utf-8"
        continue
      }

      $Extension = [System.IO.Path]::GetExtension($FullPath)
      $ContentType = if ($MimeTypes.ContainsKey($Extension)) { $MimeTypes[$Extension] } else { "application/octet-stream" }
      $Body = [System.IO.File]::ReadAllBytes($FullPath)
      Send-Response $Stream "200 OK" $Body $ContentType
    } finally {
      $Client.Close()
    }
  }
} finally {
  $Listener.Stop()
}
