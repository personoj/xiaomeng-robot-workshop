# 实拍焊接光效

依据用户提供的 `codex-clipboard-94c57fb1-1c86-4281-af35-3008685c88f2.png` 还原光学外观：紧贴焊点的高亮白蓝核心、少数长短不齐的细星芒和微弱外晕，少量向外并下落的短火星，偏斜、卷曲且局部成团的半透明蓝灰烟羽，气嘴及近处管壁受到青蓝照明。烟雾采用不同上升速度、随高度增强的侧向风和卷曲、脉动浓淡、噪声扭曲的团状轮廓，避免均匀直柱。照片中的曝光和烟雾形态用程序化近似；单张图片不能给出工艺动力学，也不能保证像素级 1:1。

## 模块与边界

`frontend/welding-effects.js` 提供 `createWeldingEffects()`，没有新依赖、外部纹理请求或机器人控制逻辑。弧光用相机朝向的 shader 四边形，火星用短线段，烟雾用带噪声的透明粒子；默认为 96 个火星槽、112 个烟雾槽，资源复用。火星/烟雾参与深度测试；光芯先做光源遮挡判断，再显示向外扩散的镜头光芒。点光源范围为 0.36 m，不投射额外阴影。

本模块只负责光、火星与烟雾。焊肉须由 `tube-panel-model.js` 的已接受接触轨迹生成；不通过时间或粒子效果补画假焊道。

## 接口

```js
import { createWeldingEffects } from './welding-effects.js';

const effects = createWeldingEffects({
  scene,                   // 可选；否则调用 scene.add(effects.root)
  up: [0, 0, 1],           // 世界向上，默认 Z-up
  wind: [0.042, -0.014, 0], // 世界风速，m/s
  scale: 1,                // 1 世界单位 = 1 m；缩放全部效果尺寸及速度
  seed: 94,
  maxSparks: 96,
  maxSmoke: 112,
});

effects.setViewport(renderer.domElement.height, camera.fov);
effects.update({
  point: worldContact,      // THREE.Vector3 或 [x, y, z]
  direction: toNozzle,      // 从接触点指向气嘴，不是射入工件的方向
  arcOn: acceptedArcState,  // 真实执行的起弧状态
  dt: elapsedSeconds,
  intensity: 1,            // 可选，非负
});

// 停弧后仍逐帧更新，残留粒子在世界坐标中自然消散。
effects.update({ arcOn: false, dt: elapsedSeconds });
effects.clear();           // 场景归零：立刻清空残留
effects.dispose();         // 移除 root、释放 geometry/material/light；可重复调用
```

`root` 必须直接挂到没有平移、旋转或缩放的场景层；输入为世界坐标，烟雾和火星不会随焊枪整体搬动。若工件坐标来自某个旋转的管排，应先 `localToWorld()` 得到实际焊点；`direction` 也须转换为世界方向。

气嘴离金属的间距由机器人执行层决定。弧光中心放在接触点往气嘴方向 7 mm 处，点光源在 18 mm 处；这些是视觉参数，不改变机械臂位置或焊痕。起弧后停止更新会冻结残留，所以无论 `arcOn` 是否为真都应调用 `update()`。

`getStats()` 返回起弧状态、活跃粒子和累计发射数，供检视和检查；界面无需向观众展示这些参数。恢复后台页时只对短时间发射粒子，已有粒子按时间老化，避免积累后突然爆发。

## 独立检视页

`frontend/weld-effects-studio.html` 与 `frontend/weld-effects-studio.js` 只加载短管排、简化气嘴与一段黄色支臂。接触处有一小段固定的点固焊供光效检视，不会增长。提供现场角度、接缝近景、全景及起弧开关，明确标注「独立视觉预览 · 尚非机械臂任务执行」。不能把本页当成机械臂完成焊接的验收。

HTML 已由父任务加入 Vite 构建入口，8090 服务可访问 `/weld-effects-studio.html`，工作坊设置内提供链接。检视页使用弱环境反照与柔和补光保留管壁、气嘴细节；正式工作坊的模型焊接执行已复用该光效，详见 WORKSHOP_WELDING.md。

## 已验证

运行 `node scripts/check-welding-effects.mjs`：世界点/气嘴方向锚定；移动焊点不搬动旧烟羽；停弧立即熄光且不继续发射；烟羽在约 3 秒内消散；粒子槽固定；属性数值有限；后台间隔不会产生发射爆发；资源释放可重复调用。30 FPS 与 60 FPS 的发射计数一致。

第一版在独立隐藏浏览器页检查了三个角度、起弧与停弧状态，Shader 编译和控制台无错误。第一版 proof 保存于 `.local/welding-fx-photo.png`、`.local/welding-fx-detail.png`、`.local/welding-fx-off.png`。按父任务的生产页观察进一步调整了卷曲烟团、细长不规则星芒和环境反照，并重新通过检查脚本；这轮生产页视觉由父任务重建后验收。正式机器人焊接链路仍由父任务集成验证。

第二轮生产构建已在8090检视：卷曲烟羽、接缝近景、停弧后火星/烟羽归零，控制台无错误。最终图像为 `.local/welding-fx-final.png`。
