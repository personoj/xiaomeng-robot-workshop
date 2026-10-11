# 原理讲解：图声同步版

讨论086–088批准使用ImageGen逐主题关键帧重制，再用计算几何生成中间帧。当前四主题均有小萌现有音色的真实录音；主页面语音工具和ESP32播放进度已接通。机器人工作坊与讲解分别运行。

## 使用

- 在小萌上说“讲解坐标变换”“讲解逆运动学”“讲解PointNet++”或“讲解碰撞与路径规划”。模型选择 `show_principle_lesson(topic)`。
- “停止原理讲解”对应 `stop_principle_lesson`，不调用机器人任务暂停。BOOT打断、会话退出和页面断开也会终止旧配音。
- `/principle-studio.html` 提供四主题原声播放、暂停、跳段、拖动和重播。这里由浏览器播放同一份录音，适合独立校对。
- 主页面保持语音操作；道具、相机、焊接程序没有因讲解主题切换而重置。

| 主题 | 实录时长 | 内容 |
| --- | ---: | --- |
| 坐标变换 | 59.00秒 | 参照系、旋转、平移、变换链 |
| 逆运动学 | 58.08秒 | 正解、位置误差、雅可比局部修正、多解与可达范围 |
| PointNet++ | 63.48秒 | 空间点集、最远点采样、球邻域、共享MLP与逐通道池化 |
| 碰撞与路径规划 | 60.29秒 | 整段碰撞、障碍扩张与间隙、A*、路径简化与连续验证 |

时长来自24 kHz单声道PCM采样数，合计240.85秒。每主题4章、每章3句，共48个语义段。它们并非均分章节时间：每句实际录音时长映射到该句的几何变化。旧140–149秒预算已经撤除。

## 声音和动画时钟

`frontend/principle-narration.json` 保存实录声线、模型、48句正文、真实采样数和时间偏移。`scripts/record-principle-narration.py` 使用现有配置的 `qwen-audio-3.1-realtime-plus / longanqian_v3.1` 独立生成录音，不占用用户设备会话。逐句返回转写与稿件一致；每章和每主题均直接串联PCM，没有人为填充的长停顿。文件在 `frontend/public/principles/audio/`。更改正文后须重录对应句子，不能手工改秒数冒充实测。

- 浏览器预览：`HTMLAudioElement.currentTime` 是播放时钟。等待缓冲、暂停、定位和结束均由同一音频元素驱动。
- 设备讲解：前端解包WAV，使用SDK `prepareNarration`；录音绑定当前真实工具调用。Harness用现有设备音频通道播放，窗口最多领先设备已播位置0.75秒。
- 前端只向设备确认过的时间平滑靠近，不预测超过已播样本。真实 `drained:true` 才显示完成、保存听完记录。
- 大音频载荷不进入模型工具结果、会话上下文或trace。用户打断后清除旧音频；迟到结果不会续读。
- 录音失败/设备未就绪时报告失败，不用浏览器系统音色替代设备。知识库仍未加入本轮。

通用协议详见 [页面预录配音](../../xiaoyun-realtime/docs/page-narration.md)。浏览器调试API仍为 `window.xiaomengPrinciples`；默认 `start(topic)` 使用真实录音，`{mode:'automatic'}` 仅供显式静音校对，`{mode:'narration'}` 等待设备回执。

## 设计和实现

内置ImageGen先生成统一方向，再分别生成四主题各四章关键帧。原图和完整提示词保存在 [设计资产](design/principles/README.md)。程序按其深蓝、冰蓝、橙色、玻璃平面、珠光节点与金属连杆重建；主图放大，重复小卡片移除，公式独立排版。

- `principle-scenes/spatial.js / spatial-kit.js`：坐标与两连杆IK。
- `principle-scenes/cloud-planning.js / cloud-kit.js`：2,016个真实参与算法的点、球邻域、共享网络与逐通道汇聚；等距透视障碍、间隙和经过检查的路径。
- `principle-diagrams.js`：统一舞台入口。
- `principle-compositor.js`：连续章节合成，标签先退后入，避免两层文字叠印。
- `principle-lessons.js`：章节、真正上下标的MathML、简短说明和原理出处。
- `principle-player.js / principle-timeline.js`：浏览器/设备时钟、暂停和过期进度处理。
- `principle-voice.js`：正式语音工具和预录声音桥接，不含机器人控制。
- `principle-studio.*`：独立校对入口。

生成图中的错误不直接照搬：IK保留两根刚性连杆；规划用数学模型中的圆柱障碍，路径必须经过实际间隙检查。PointNet++是算法结构示意，未运行训练好的识别网络；圆盘规划和两连杆也不等于真实六轴机器人执行器。

## 检查结果和范围

- 31项数学、音频采样、时钟和章节合成检查通过。
- Harness新增配音生命周期6项，既有PTT/音量/普通工具/异步通知36项回归通过，共42项。打断、连接归属、重复回执、发送窗口和真实drain均有覆盖。
- 30 fps全音频时间轴7,227帧：可见Canvas文字墨迹边界、文字相互覆盖和非有限几何参数检查0项问题。
- 独立逐帧像素差分、12处章节边界，以及48幅代表状态人工检查；完全重复帧占比约1.3%–4.5%，没有连续超过1秒的完全静止区间。像素指标不是审美认证，也不等于人工逐张观看了7,227帧。
- 主页面1672、1280、1080三种宽度下，4主题16个DOM公式均无横向/纵向溢出；最窄处公式字号约18px。
- 浏览器原声计时实测随currentTime推进，章节/公式随音频切换；重播后暂停的实测音频与动画都为0.938421秒，时间一致。
- 通过现有USB桥的文字测试入口触发真实模型讲解工具；坐标主题在ESP32完整播放59.00秒，最终1,416,000样本、drained=true，页面59秒完成；场景ID、对象和原任务状态保持。用户反馈“完整清楚，节奏合适”。这不是新一次真人ASR测试，也不是四主题全部硬件试听。
- 尚未以新的正在焊接任务做一整节设备并行实测；实现不调用暂停/改场景接口，不能把此结构事实包装成已经跑过全部并行情形。

设计复核、修正依据与材质差距见 [独立审查](PRINCIPLE_REDESIGN_REVIEW.md)。图形是参考关键帧的程序化重建，光感、景深、反射仍与生成图存在差异，不宣称逐像素1:1。

本机证据：`.local/principle-redesign/`、`.local/motion-review/keyframes-release/`；截图为 `.local/principle-redesign/workshop.png`。原理出处保留于播放器链接及 [内容说明](PRINCIPLE_CONTENT.md)。

验证命令：

```powershell
node --test tests/principle-math.test.mjs tests/principle-timeline.test.mjs tests/principle-compositor.test.mjs tests/principle-narration.test.mjs
node scripts/check-principle-layout.mjs
node scripts/audit-principle-motion.mjs --label=review-new --compositor
npm run build
```
