# 云端复审证据 / Cloud review evidence

这是已审查代码的补充证据提交，不改变功能。完整测试命令、边界和兼容性见 [协议报告](../CLOUD_PROTOCOL_REVIEW.md) 与 [性能报告](../PERFORMANCE_CLOUD_REVIEW.md)。

## 已确认
- 坐标第4章 T_BW 标签与世界竖轴相交；稳定移位和短引线修复。[同帧对照](label-before-after.png)，51.680 s / 56.776 s。
- 非标准目标比例使图形非均匀拉伸；改为等比缩放和深蓝留边。[对照](aspect-before-after.png) 的318×180/318×400是合成画布，**不是实测浏览器侧栏**。
- 两版各7227帧离屏审计，检查有限坐标、文字边界和文字间相交；48个beat、36个过渡采样做过图像检查。它不证明所有几何遮挡都已消除。46/48规范beat采样像素一致。
- 3对干净同机CPU样本：完整预检中位24.956→13.124s，减少47.4%；2445帧、14焊段计划完全相等。逐子步安全检查不减少。
- CPU姿态/管线网格更新p95 12.138→6.766ms，**不是浏览器帧时间**。
- 80 Node + 26 Python与生产构建通过；独立只读复审发现的取消/重启/晚到包漏洞均补回归。

## 尚未验收
实际1920×1080、1440×900、1280×720、1080宽窗口的主侧栏/studio，DOM MathML，真实GPU/FPS、模型语义和设备声学未验收。公式CSS未改，固有宽度问题只是未验证线索。云端浏览器启动被socket策略阻止；已有平台浏览器无法访问隔离后端且明确拒绝file URL。没有绕过限制。交付的浏览器审计脚本启用Chromium sandbox。

## 原始数据
- [性能摘要和排除规则](performance-summary.json)
- [所有纳入的原始CPU样本，gzip JSON](performance-clean-samples.json.gz)：原第2/3对＋单独重测1对，保留源批次标记
- [动画before](animation-before.json) / [after](animation-after.json) / [像素对照](animation-pixel-comparison.json)
- [测试摘要及原始基线](test-summary.json)

只对JSON中的绝对工作区前缀做了去标识替换；数值、样本、源文件哈希、图片字节保持原样。不含私人录音、真实会话、密钥或Library私有链接。跨仓draft链接和部署顺序见PR正文；不得自动合并。
