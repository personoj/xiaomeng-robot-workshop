param([int]$Port=8090)
$ErrorActionPreference='Stop'
$projectDirectory=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stateDirectory=Join-Path $projectDirectory '.local'
New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
try {
    $health=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
    if($health.service -eq 'xiaoyun-robot-demo'){Write-Output "Already running: http://127.0.0.1:$Port";exit 0}
} catch {}
if(-not(Test-Path -LiteralPath (Join-Path $projectDirectory 'src/embodied_jev/web/index.html'))){throw 'Run npm run build first.'}
$env:PYTHONUTF8='1'
. (Join-Path $PSScriptRoot 'public-python.ps1')
$pythonExecutable=Resolve-PublicPython
$env:XIAOYUN_PYTHON=$pythonExecutable
$serverProcess=Start-Process -FilePath $pythonExecutable -ArgumentList '-m','uvicorn','embodied_jev.xiaoyun_demo:create_app','--factory','--app-dir','src','--host','127.0.0.1','--port',"$Port" -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDirectory 'server.stdout.log') -RedirectStandardError (Join-Path $stateDirectory 'server.stderr.log') -PassThru
$serverProcess.Id | Set-Content -LiteralPath (Join-Path $stateDirectory 'server.pid')
for($attempt=0;$attempt -lt 24;$attempt++){
    Start-Sleep -Milliseconds 250
    try{$health=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 1;if($health.service -eq 'xiaoyun-robot-demo'){Write-Output "Ready: http://127.0.0.1:$Port";exit 0}}catch{}
}
throw 'Demo did not start. See .local/server.stderr.log.'
