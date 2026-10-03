[CmdletBinding(DefaultParameterSetName='Project')]
param(
 [Parameter(Mandatory=$true,ParameterSetName='Project')][string]$LeafSdkProject,
 [Parameter(Mandatory=$true,ParameterSetName='Assembly')][string]$LeafSdkAssembly,
 [string]$LeafPolicyProject,
 [string]$ScratchRoot=$env:REDLEAF_SCRATCH_DIR
)
$ErrorActionPreference='Stop'
if(-not $ScratchRoot){throw 'REDLEAF_SCRATCH_DIR is required.'}
$root=[IO.Path]::GetFullPath($PSScriptRoot)
$validation=[IO.Path]::GetFullPath((Join-Path $ScratchRoot ('storyboard/validation-'+[Guid]::NewGuid().ToString('N'))))
if($validation.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Evidence must be outside the repository.'}
New-Item -ItemType Directory -Force -Path $validation | Out-Null
$sdkArgument=if($LeafSdkAssembly){"-p:LeafSdkAssembly=$LeafSdkAssembly"}else{"-p:LeafSdkProject=$LeafSdkProject"}
$testProperties=@($sdkArgument)
if($LeafPolicyProject){$testProperties+="-p:LeafPolicyProject=$LeafPolicyProject"}
Start-Transcript -Path (Join-Path $validation 'stage.log') | Out-Null
Push-Location $root
try{
 & dotnet test tests/Storyboard.Backend.Tests/Storyboard.Backend.Tests.csproj --artifacts-path (Join-Path $validation 'build') @testProperties --results-directory (Join-Path $validation 'results') --logger 'trx;LogFileName=backend.trx' --nologo -v minimal
 if($LASTEXITCODE -ne 0){throw 'Backend/TestHost tests failed.'}
 & node --test operator/migration.test.mjs
 if($LASTEXITCODE -ne 0){throw 'One-time operator source tests failed.'}
 & pnpm test
 if($LASTEXITCODE -ne 0){throw 'Worker/frontend source tests failed.'}
 $arguments=@{ScratchRoot=$ScratchRoot}
 if($LeafSdkAssembly){$arguments.LeafSdkAssembly=$LeafSdkAssembly}else{$arguments.LeafSdkProject=$LeafSdkProject}
 & (Join-Path $root 'build-leafpkg.ps1') @arguments
 if(-not $?){throw 'Packaging failed.'}
 [ordered]@{evidence=$validation;productionWrites=0;deployment='none';authenticatedAcceptance='not performed'} | ConvertTo-Json
}finally{Pop-Location;Stop-Transcript | Out-Null}
