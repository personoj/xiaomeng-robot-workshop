# 原理讲解视觉重制

本轮由内置 ImageGen 生成视觉方向，再生成每主题四个关键帧。生成稿负责构图、光感与层次；正式画面以确定性的数学几何重建，可暂停、定位，并由同音色录制音频的实际播放位置驱动。生成稿里的数学文字需在实现中重新排版与核对。

主方向：深蓝舞台、冰蓝几何、橙色重点。单一主图，真实上下标公式，去掉重复小卡片。主设计参考为 `art-direction.png`。

生成提示概要：production art direction contact sheet, four Chinese robotics mathematics explainers, refined keynote motion design, generous negative space, near-black midnight navy #07172b, ice blue #84d9f4, tangerine #ff983f, frosted pearl links, isometric translucent coordinate plane, spherical point-cloud neighbourhood, extruded planning obstacles, restrained soft illumination, no decorative data readouts.


| 主题 | ImageGen关键帧 | 完整提示词 |
| --- | --- | --- |
| 总体方向 | [方向稿](art-direction.png) | [提示词](art-direction-prompt.md) |
| 坐标变换 | [四章关键帧](coordinates-keyframes.png) | [提示词](coordinates-prompt.md) |
| 逆运动学 | [四章关键帧](inverse-kinematics-keyframes.png) | [提示词](inverse-kinematics-prompt.md) |
| PointNet++ | [四章关键帧](pointnet-keyframes.png) | [提示词](pointnet-prompt.md) |
| 路径规划 | [四章关键帧](planning-keyframes.png) | [提示词](planning-prompt.md) |

音频与时间见 [配音记录](narration.md)，视觉/语义复核见 [审查记录](../../PRINCIPLE_REDESIGN_REVIEW.md)。生成图作为设计依据，正式图形由Canvas计算，不以图片轮播替代动画。数学文字由MathML和Canvas真正上下标重排。
