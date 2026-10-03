[CmdletBinding(DefaultParameterSetName='Project')]
param(
 [Parameter(Mandatory=$true,ParameterSetName='Project')][string]$LeafSdkProject,
 [Parameter(Mandatory=$true,ParameterSetName='Assembly')][string]$LeafSdkAssembly,
 [string]$ScratchRoot=$env:REDLEAF_SCRATCH_DIR
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($PSScriptRoot)
if(-not $ScratchRoot -or -not (Test-Path -LiteralPath $ScratchRoot)){throw 'REDLEAF_SCRATCH_DIR is required.'}
$scratch=[IO.Path]::GetFullPath((Join-Path $ScratchRoot 'storyboard'))
if($scratch -eq $root -or $scratch.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Artifacts must be outside the repository.'}
$sdkPath=if($LeafSdkAssembly){$LeafSdkAssembly}else{$LeafSdkProject}
if(-not (Test-Path -LiteralPath $sdkPath)){throw 'Pass the host SDK project or assembly explicitly.'}
$sdkArgument=if($LeafSdkAssembly){"-p:LeafSdkAssembly=$LeafSdkAssembly"}else{"-p:LeafSdkProject=$LeafSdkProject"}
$run=Join-Path $scratch ('stage-'+[Guid]::NewGuid().ToString('N'))
$package=Join-Path $run 'package'
$backend=Join-Path $package 'backend'
$frontend=Join-Path $package 'web/dist'
$site=Join-Path $backend 'site'
$artifacts=Join-Path $run 'build'
New-Item -ItemType Directory -Force -Path $backend,$frontend,$site | Out-Null
Push-Location $root
try{
 & dotnet publish src/Leaf.Plugins.Storyboard/Leaf.Plugins.Storyboard.csproj -c Release --artifacts-path $artifacts -o $backend $sdkArgument --nologo -v minimal
 if($LASTEXITCODE -ne 0){throw 'Backend publish failed.'}
 $sdkBuilt=if($LeafSdkAssembly){$LeafSdkAssembly}else{Join-Path $backend 'Leaf.Sdk.dll'}
 $sdkHash=(Get-FileHash -LiteralPath $sdkBuilt -Algorithm SHA256).Hash.ToLowerInvariant()
 # Preserve the host's shared SDK type identity. Only exact files in this run are removed.
 foreach($name in @('Leaf.Sdk','RedBamboo.AppHost')){
  foreach($ext in @('dll','pdb','xml')){
   $file=[IO.Path]::GetFullPath((Join-Path $backend "$name.$ext"))
   if(-not $file.StartsWith([IO.Path]::GetFullPath($backend)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid package file path.'}
   if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force}
  }
 }
 $previousPlugin=$env:STORYBOARD_PLUGIN_OUTPUT;$previousSite=$env:STORYBOARD_SITE_OUTPUT
 try{
  $env:STORYBOARD_PLUGIN_OUTPUT=$frontend;$env:STORYBOARD_SITE_OUTPUT=$site
  & pnpm typecheck
  if($LASTEXITCODE -ne 0){throw 'Frontend/Worker typecheck failed.'}
  & pnpm build:plugin
  if($LASTEXITCODE -ne 0){throw 'Federated build failed.'}
  & pnpm build:site
  if($LASTEXITCODE -ne 0){throw 'Standalone build failed.'}
 }finally{$env:STORYBOARD_PLUGIN_OUTPUT=$previousPlugin;$env:STORYBOARD_SITE_OUTPUT=$previousSite}
 Copy-Item -LiteralPath (Join-Path $root 'plugin.json') -Destination $package
 Copy-Item -LiteralPath (Join-Path $root 'seeds') -Destination $package -Recurse
 Copy-Item -LiteralPath (Join-Path $root 'README.md') -Destination $package
 # Operator code is deliberately outside the runtime package; private plans and
 # exports never enter an artifact. Nova executes it separately after approval.
 foreach($file in @('backend/Leaf.Plugins.Storyboard.dll','backend/site/index.html','web/dist/plugin.js','web/dist/plugin.css','web/dist/remoteEntry.js','seeds/entity-types.json','seeds/field-definitions.json')){
  if(-not (Test-Path -LiteralPath (Join-Path $package $file))){throw "Missing package contract: $file"}
 }
 $manifest=Get-Content -LiteralPath (Join-Path $root 'plugin.json') -Raw | ConvertFrom-Json
 $pkg=Join-Path $run "$($manifest.id)-$($manifest.version).leafpkg"
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 [IO.Compression.ZipFile]::CreateFromDirectory($package,$pkg)
 $hash=(Get-FileHash -LiteralPath $pkg -Algorithm SHA256).Hash.ToLowerInvariant()
 Set-Content -LiteralPath "$pkg.sha256" -Value $hash -Encoding utf8
 $sourceHashes=@(& rg --files --hidden -g '!.git/**' -g '!**/node_modules/**' -g '!**/dist/**' -g '!**/site-dist/**' -g '!**/bin/**' -g '!**/obj/**' -g '!**/.wrangler/**' -g '!.dev.vars' | Sort-Object | ForEach-Object{[ordered]@{path=$_;sha256=(Get-FileHash -LiteralPath (Join-Path $root $_) -Algorithm SHA256).Hash.ToLowerInvariant()}})
 $artifactHashes=@(Get-ChildItem -LiteralPath $package -File -Recurse | ForEach-Object{[ordered]@{path=[IO.Path]::GetRelativePath($package,$_.FullName);sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}})
 $commit=& git rev-parse --verify HEAD 2>$null
 if($LASTEXITCODE -ne 0){$commit=$null}
 $receipt=[ordered]@{package=$pkg;sha256=$hash;backend=$backend;site=$site;frontend=$frontend;source=$root;sourceBranch=(& git branch --show-current);sourceCommit=$commit;sourceDirty=[bool](& git status --porcelain);sourceHashes=$sourceHashes;artifactHashes=$artifactHashes;sdkPath=[IO.Path]::GetFullPath($sdkPath);sdkAssemblySha256=$sdkHash;activation='staged, not activated';worker='source only, not published'}
 $receiptPath=Join-Path $run 'receipt.json'
 $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8
 $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $scratch 'latest-stage.json') -Encoding utf8
 [ordered]@{receipt=$receiptPath;package=$pkg;sha256=$hash;activation='staged, not activated'} | ConvertTo-Json
}finally{Pop-Location}
