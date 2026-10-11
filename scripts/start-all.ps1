param([string]$Port='COM9', [switch]$NoBrowser, [switch]$ShowStatus)
$ErrorActionPreference='Stop'
$demoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspaceRoot=Split-Path $demoRoot -Parent
$voiceRoot=Join-Path $workspaceRoot 'xiaoyun-realtime'
$deviceRoot=Join-Path $workspaceRoot 'xiaoyun-esp32'
$stateDirectory=Join-Path $demoRoot '.local'
New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
$logPath=Join-Path $stateDirectory 'start-all.log'
. (Join-Path $PSScriptRoot 'public-python.ps1')
$pythonExecutable=Resolve-PublicPython
$env:XIAOYUN_PYTHON=$pythonExecutable
$startupMutex=New-Object System.Threading.Mutex($false,'Local\XiaomengDemoStart')
$ownsMutex=$false

function Write-StartupLog([string]$Message) {
    ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'),$Message) | Add-Content -LiteralPath $logPath -Encoding UTF8
    Write-Output $Message
}
function Start-Component([string]$Script, [hashtable]$ScriptArguments) {
    # Each existing entry point owns its process and reuses a running instance.
    $output=& $Script @ScriptArguments 2>&1
    if($LASTEXITCODE -ne 0){throw ($output | Out-String)}
    foreach($line in $output){Write-StartupLog ([string]$line)}
}

try {
    try{$ownsMutex=$startupMutex.WaitOne(0)}catch [System.Threading.AbandonedMutexException]{$ownsMutex=$true}
    if(-not $ownsMutex){Write-Output 'Startup is already in progress.';exit 0}
    Write-StartupLog 'Starting Xiaomeng: voice harness + workshop + ESP32 USB bridge.'
    Start-Component (Join-Path $voiceRoot 'scripts/start.ps1') @{Python=$pythonExecutable}
    Start-Component (Join-Path $demoRoot 'scripts/start-xiaoyun.ps1') @{}
    Start-Component (Join-Path $deviceRoot 'scripts/start_usb.ps1') @{Port=$Port}

    $voice=Invoke-RestMethod 'http://127.0.0.1:8766/api/health' -TimeoutSec 3
    $workshop=Invoke-RestMethod 'http://127.0.0.1:8090/api/health' -TimeoutSec 3
    if($voice.service -ne 'xiaoyun-realtime' -or $workshop.service -ne 'xiaoyun-robot-demo'){throw 'Unexpected service on the configured ports.'}
    $catalog=Invoke-RestMethod 'http://127.0.0.1:8766/api/sessions' -TimeoutSec 3
    $deviceSession=$catalog.device_session_id
    $pageConnected=@($catalog.sessions | Where-Object {$_.session_id -eq $deviceSession -and $_.page_connected}).Count -gt 0
    $url='http://127.0.0.1:8090/'
    if($deviceSession){$url+='?session='+[Uri]::EscapeDataString($deviceSession)}
    $opened=$false
    if(-not $NoBrowser -and -not $pageConnected){Start-Process $url;$opened=$true}

    # An unplugged USB device is allowed: the existing bridge waits for COM9.
    # Report actual fresh device traffic separately from merely starting a process.
    $usbConnected=$false
    $cutoff=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()-20
    $bridgeLog=Join-Path $deviceRoot '.local/bridge.stdout.log'
    if(Test-Path -LiteralPath $bridgeLog){
        foreach($line in (Get-Content -LiteralPath $bridgeLog -Tail 40)){
            try{$event=$line | ConvertFrom-Json}catch{continue}
            if($event.at -ge $cutoff -and $event.type -in @('bridge.ready','device.telemetry','device.display')){$usbConnected=$true}
        }
    }
    $status=[ordered]@{checked_at=(Get-Date -Format o);harness='ready';workshop='ready';usb_port=$Port;usb_connected=$usbConnected;page_already_connected=$pageConnected;browser_opened=$opened;url=$url}
    $status | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDirectory 'start-all-status.json') -Encoding UTF8
    Write-StartupLog ($status | ConvertTo-Json -Compress)
    if($ShowStatus){
        $usbText=if($usbConnected){"USB设备已连接（$Port）"}else{"USB桥已启动，等待设备（$Port）"}
        $pageText=if($pageConnected){'工作坊已连接，复用现有页面。'}else{'已打开工作坊，正在连接设备会话。'}
        $shell=New-Object -ComObject WScript.Shell
        $null=$shell.Popup("语音服务、工作坊已就绪。`n$usbText`n$pageText`n`n说「你好小萌」唤醒，再按住BOOT说话，松开提交。",8,'小萌演示已启动',64)
    }
} catch {
    $message=$_.Exception.Message
    Write-StartupLog ('FAILED: '+$message)
    if($ShowStatus){$shell=New-Object -ComObject WScript.Shell;$null=$shell.Popup("启动未完成：`n$message`n`n日志：$logPath",0,'小萌演示启动失败',16)}
    exit 1
} finally {
    if($ownsMutex){$startupMutex.ReleaseMutex()}
    $startupMutex.Dispose()
}
