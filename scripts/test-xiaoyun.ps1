$ErrorActionPreference='Stop'
$projectDirectory=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $projectDirectory
try {
    $env:PYTHONUTF8='1'
    $env:PYTHONPATH=Join-Path $projectDirectory 'src'
    $testDirectory=Join-Path $projectDirectory ('.local/tests/'+[guid]::NewGuid().ToString('N'))
    & 'D:\conda\envs_dirs\codex\Scripts\python.exe' -m pytest tests/test_xiaoyun_demo.py -q -p no:cacheprovider --basetemp $testDirectory
    if($LASTEXITCODE -ne 0){throw 'Demo integration tests failed.'}
    node --test tests/xiaoyun-controller.test.mjs tests/xiaoyun-presentation.test.mjs
    if($LASTEXITCODE -ne 0){throw 'Demo controller tests failed.'}
} finally {Pop-Location}
