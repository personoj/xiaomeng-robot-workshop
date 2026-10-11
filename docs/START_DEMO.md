# 一键启动演示

双击桌面 **小萌演示一键启动**，或工作区根目录 **启动小萌演示.cmd**。

入口依次启动8766语音Harness、8090工作坊和COM9 USB桥。已有进程直接复用，不重启、不归零、不改变道具或设备会话。未接USB时桥接程序等待设备插入。尚无已连接工作坊页面时，会在默认浏览器打开设备当前绑定的会话；已有页面连接时复用它，避免争抢page通道。

设备接上USB后，说“你好小萌”，按住BOOT说话、松开提交。需要互联网访问千问；本机页面和USB链路不依赖原来的Wi-Fi地址。启动入口不修改防火墙、固件或密钥。

给Agent/终端的入口：

```powershell
& 'D:\1a_work\10.10\xiaoyun-robot-demo\scripts\start-all.ps1'
```

加 `-NoBrowser` 仅启动/复用三个进程；换串口用 `-Port COM9`。日志在 `.local/start-all.log`，最近一次状态在 `.local/start-all-status.json`。状态会区分USB已传回数据和仅有桥接进程，避免把“等待设备”写成完整连接。

启动文件路径相对于工作区组织，三个项目应继续放在同一父目录。Python沿用 `D:\conda\envs_dirs\codex\Scripts\python.exe`。带电脑外出演示直接使用现有构建；代码改动后仍需正常构建更新前端。
