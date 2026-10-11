> 三个公开仓库的安装、职责和配对方式见 [INTEGRATION.md](INTEGRATION.md)。本快照的未验证修复见 [RELEASE_NOTES.md](RELEASE_NOTES.md)。云端优化任务见 [CLOUD_AGENT_PROMPT.md](CLOUD_AGENT_PROMPT.md)。

# 小萌 · 机器人工作坊

语音控制的持续三维场景，结合 Three.js、MuJoCo/Panda 与千问决策模型。基于 EmbodiedJev f08de2e4e20d6cd69fea9c57ac1062c3ef510f1e；上游说明保存在 README.upstream.md。

## 当前能力

- 同一大场景容纳抓手机械臂、小萌 H、竖立钢管管排与桌面道具，任务变化不切换场景。
- 球、方块和托盘具有稳定编号；删除不重排，新增不复用旧编号，语音按中文号数播读。
- 千问 decision-model-preview 从场内候选中选择源/目标，MuJoCo 执行抓放入盘与方块叠放。缺失、含糊或过期的对象选择不会直接执行。
- 召唤小萌 H7 出现在固定出生位。焊接任务先驶入对应工位、锁定底盘，再由机械臂从右到左完成14个间隔短焊段。先预检关节、定长管线与碰撞。
- 道具库使用实际三维缩略图，点击聚焦镜头；场内名称仅悬停显示。操作主要通过小萌语音发起。
- 场景1/2/3分别为抓取近景、总览、当前焊接工位近景，只切换镜头。支持五个独立编号管排工位。
- 独立焊接效果检视：白蓝弧光、火星、烟羽和局部反照；该光效也已接入工作坊的模型焊接动作。

## 启动

```powershell
cd D:\1a_work\10.10\xiaoyun-robot-demo
npm run build
.\scripts\start-xiaoyun.ps1
```

打开 [机器人工作坊](http://127.0.0.1:8090/)。设置内可打开 [模型检视](http://127.0.0.1:8090/model-studio.html) 和 [焊接效果检视](http://127.0.0.1:8090/weld-effects-studio.html)。前端首次安装运行 npm ci。Python 使用 D:/conda/envs_dirs/codex/Scripts/python.exe。

语音后端位于邻接目录 xiaoyun-realtime，默认 http://127.0.0.1:8766/。本项目不改动设备固件与语音服务。

## 连接与使用

设置中选择已有会话或新建会话，ESP32 同步绑定所选会话，旧对话保留。也支持 `?session=32位会话ID`。网页占用 page 通道，ESP32 占用 audio 通道；同一会话不要同时打开多个控制页面。

可说：“把蓝色二号球放进红色一号托盘”“把红色一号方块叠到蓝色一号方块上”“添加一个黄色的球”“删除黄色一号球”“把焊接机器人开进来”“焊接管排1的第二条缝”“暂停一下”“继续”。含糊时先补充编号。复杂目标按单步工具执行，不假报完成。

“归零模式”结束任务和讲解，清空所有球、方块、托盘、管排及焊痕，收起焊机；保留桌子、房间、白色机械臂和语音会话，回到抓取镜头。新增编号继续递增，不复用旧ID。设备待机、打断语音、暂停机械臂分别处理。

千问配置位于忽略提交的 `.local/decision.json`，只保存模型、官方接口地址和外部 key 文件路径。密钥只由服务器读取，不放网页、源码或报告。

## 验证与边界

```powershell
$env:PYTHONPATH='src'
$env:PYTHONUTF8='1'
& 'D:\conda\envs_dirs\codex\Scripts\python.exe' -m pytest tests/test_workshop.py -q --basetemp .local/pytest-workshop
node scripts/check-welding-effects.mjs
npm run build
```

当前真实决策 API → 仿真链路已验证球入盘、方块叠放、道具增删；也验证持续身份、暂停恢复、模型候选约束。此次未重新进行 ESP32 语音声学验收。详细结果与限制见 [WORKSHOP.md](docs/WORKSHOP.md)，光效接口见 [WELDING_EFFECTS.md](docs/WELDING_EFFECTS.md)。

服务仅监听 loopback；场景和编号保存到 `.local/workshop-scene.json`，重启不重置道具。进行中的任务不自动恢复。旧版固定场景 API 与上游源码保留，当前主界面使用 `/api/workshop`。

语音协议见 [DEMO_AUDIO_INTERFACE.md](docs/DEMO_AUDIO_INTERFACE.md)。上游许可见 LICENSE、THIRD_PARTY_NOTICES.md 及 src/embodied_jev/assets/panda/LICENSE。仿真验证不等于实体机器人控制。

焊接接入与启停验证详见 [WORKSHOP_WELDING.md](docs/WORKSHOP_WELDING.md)。焊缝从上到下编号1–7，已完成的缝不会重复执行。

讨论068纠正后的点焊与视角说明见 [STITCH_WELDING.md](docs/STITCH_WELDING.md)，替代此前边行走边连续焊接的行为。
