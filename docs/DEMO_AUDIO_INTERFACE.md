# 演示页面的语音与任务展示接口

页面入口 `http://127.0.0.1:8090/`，语音服务 `http://127.0.0.1:8766/`。演示页面占 `page` 通道，ESP32 或电脑工作台占同一 session 的 `audio` 通道。网页不申请麦克风、不播放另一份语音，也不持有云端密钥。

## 三处内容分别属于谁

| 区域 | 来源 | 行为 |
|---|---|---|
| 上方流线 | 小云实际播放的音频能量 | 收到播放进度确认后运动；停止、打断、断线或信号过期后静止 |
| 本次指令 | `demo-presentation.js` 的 TASK_COPY | 根据已受理任务 `transfer / stack / barrier` 选择固定文案；不使用用户转写或模型回答 |
| 下方短波形和字幕 | 用户/ESP32 的输入音频与识别文本 | 音量控制短条；文字短暂显示，6.5 秒后回到“等待下一步指令” |

## 当前 WebSocket 接入

设备仍使用已有 `input.audio`（PCM16LE，16 kHz，单声道）和 `playback.progress`。无需固件增加新的波形上报格式。

8766 在收到输入 PCM 后，以最高约 12.5 Hz 向 page 发送：

```json
{"type":"audio.activity","channel":"input","level":0.35,"active":true,"source":"capture"}
```

输出 PCM 只暂存 RMS 能量片段。收到终端真实 `playback.progress` 后才向 page 发送：

```json
{"type":"audio.activity","channel":"output","level":0.42,"active":true,"source":"playback","response_id":"..."}
```

`level` 是 0～1 的归一化 RMS，乘以 4 后限幅，不是分贝。采集/播放信号停止时 level=0、active=false。输入仍由现有 `transcript.user` 提供识别结果。高频能量事件不进入会话记忆或诊断 trace，也不送给模型。浏览器 700 ms 没收到能量更新会回到静止，避免断线后继续假装说话。

## 预留的页面适配接口

以后如在其他传输适配器内获得 ESP32 音量或部分识别文字，可调用：

```js
window.xiaoyunDemoAudio.update({
  channel: 'input', level: 0.35, active: true,
  text: '用户当前识别文字' // 可选；只出现在下方收音区
});
window.xiaoyunDemoAudio.transcript('最终识别文字');
window.xiaoyunDemoAudio.update({channel: 'input', level: 0, active: false});
```

也可派发 `CustomEvent('xiaoyun:audio', {detail: {...同上字段}})`。不会触发机器人动作、改变任务模板或改写 Agent 上下文。正式设备已走 8766 时不需要再并行喂一份同样数据。

## 真实轨迹和验证

`GET /api/trajectory?episode_id=...` 读取 MuJoCo 已保存的红色方块 XYZ 坐标，最多采样 180 点、保留首尾。页面采用含抬升高度的正交投影；不会人为生成弧线。旧任务 ID 返回 409，重置清空显示。

到位：物体到目标的 XY 距离小于 0.025 m。稳定：实际支撑接触、稳定持续至少 0.4 秒、夹爪打开且没有禁区接触。整项“任务完成”仍要求后端 completed 且 observation.success=true，不能只根据动作数或进入最后阶段判断。

本轮没有恢复 ESP32 串口/声学测试。接口已通过本地 PCM、播放确认和真实浏览器千问联调；实机验收待设备测试恢复后进行。
