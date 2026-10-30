param([Parameter(Mandatory=$true)][ValidateSet('x64','arm64')][string]$Architecture)
$ErrorActionPreference='Stop'
$client=Split-Path $PSScriptRoot -Parent
$page=Invoke-WebRequest 'https://developer.microsoft.com/en-us/microsoft-edge/webview2/'
$html=if($page.Content -is [byte[]]){[Text.Encoding]::UTF8.GetString($page.Content)}else{[string]$page.Content}
$html=$html.Replace('\u002F','/').Replace('&amp;','&')
$pattern='https://msedge\.sf\.dl\.delivery\.mp\.microsoft\.com/filestreamingservice/files/[a-zA-Z0-9-]+/Microsoft\.WebView2\.FixedVersionRuntime\.(\d+\.\d+\.\d+\.\d+)\.'+$Architecture+'\.cab'
$matchesFound=@([regex]::Matches($html,$pattern) | Sort-Object { [version]$_.Groups[1].Value } -Descending)
if(!$matchesFound.Count){throw 'Microsoft official fixed runtime download not found'}
$download=$matchesFound[0].Value
$version=$matchesFound[0].Groups[1].Value
$cache=Join-Path $client '.cache'
$destination=Join-Path $client "src-tauri/fixed-webview2/$Architecture"
New-Item -ItemType Directory -Path $cache,$destination -Force | Out-Null
$cab=Join-Path $cache "webview-$version-$Architecture.cab"
if(!(Test-Path -LiteralPath $cab)){Invoke-WebRequest $download -OutFile $cab}
& expand.exe $cab '-F:*' $destination | Out-Null
if($LASTEXITCODE -ne 0){throw 'Cannot extract fixed WebView2 runtime'}
$runtime=Get-ChildItem -LiteralPath $destination -Filter msedgewebview2.exe -Recurse | Select-Object -First 1
if(!$runtime){throw 'WebView2 executable missing'}
$signature=Get-AuthenticodeSignature -LiteralPath $runtime.FullName
if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation'){throw 'Invalid Microsoft runtime signature'}
$relative=[IO.Path]::GetRelativePath((Join-Path $client 'src-tauri'),$runtime.Directory.FullName).Replace('\','/')
@{bundle=@{windows=@{webviewInstallMode=@{type='fixedRuntime';path=$relative}}}} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $client '.cache/fixed-webview.json') -Encoding utf8
@{version=$version;architecture=$Architecture;source=$download;sha256=(Get-FileHash $cab -Algorithm SHA256).Hash.ToLower();microsoftSignature=$signature.Status.ToString()} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $cache "webview-$Architecture.json") -Encoding utf8
Write-Output "Prepared signed Microsoft WebView2 $version ($Architecture)"
