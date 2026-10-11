import narration from './principle-narration.json' with {type:'json'};
// Lesson geometry is independent of workshop motion. Timings come from recorded PCM.
const v = (s) => `<mi>${s}</mi>`;
const n = (s) => `<mn>${s}</mn>`;
const op = (s) => `<mo>${s}</mo>`;
const row = (s) => `<mrow>${s}</mrow>`;
const index = (s) => /^\d+$/.test(s) ? n(s) : s.length > 1 ? `<mtext>${s}</mtext>` : v(s);
const sub = (a, b) => `<msub>${v(a)}${index(b)}</msub>`;
const norm = (s) => row(op('‖') + s + op('‖'));
const paren = (s) => row(op('(') + s + op(')'));
const fn = (name, s) => `<mi mathvariant="normal">${name}</mi>` + paren(s);
const under = (name, s) => `<munder><mo>${name}</mo>${row(s)}</munder>`;
const stack = (...lines) => `<mtable columnalign="left" rowspacing="0.2em">${lines.map(line => `<mtr><mtd>${row(line)}</mtd></mtr>`).join('')}</mtable>`;
const column = (...entries) => row(op('[') + `<mtable rowspacing="0.05em">${entries.map(entry => `<mtr><mtd>${entry}</mtd></mtr>`).join('')}</mtable>` + op(']'));
const escapeAttribute = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const math = (s, label) => `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" aria-label="${escapeAttribute(label)}">${row(s)}</math>`;
const step = (id, title, caption, formula, formulaLabel, note = '') => ({
  id, title, caption, formula: math(formula, formulaLabel), formulaLabel, note,
});

export const LESSONS = [
  {
    id: 'coordinates', title: '坐标变换', english: 'COORDINATE FRAMES',
    question: '同一个焊点，为什么有不同的坐标？',
    summary: '对齐方向、补上原点偏移，把相机测得的位置交给机械臂。',
    source: { title: 'Modern Robotics · 齐次变换', url: 'https://modernrobotics.northwestern.edu/nu-gm-book-resource/3-3-1-homogeneous-transformation-matrices/' },
    steps: [
      step('frames', '点没动，参照系变了', '坐标要连同参照系一起读，才有明确含义。',
        sub('p','W') + op('=') + column(sub('x','W'), sub('y','W'), sub('z','W')) + '<mspace width="1em"/>' + sub('p','C') + op('=') + column(sub('x','C'), sub('y','C'), sub('z','C')),
        '世界坐标 p 下标 W 包含 x、y、z 三个分量；相机坐标 p 下标 C 同样包含三个分量。',
        '三维空间示意。p_W 与 p_C 是同一个点在两个参照系中的坐标；特殊情况下数值也可能相同。'),
      step('rotation', '先把方向换过来', '旋转改变向量方向，保持长度与夹角。',
        norm(sub('R','WC') + sub('p','C')) + op('=') + norm(sub('p','C')),
        'R 下标 WC 乘 p 下标 C 的长度，等于 p 下标 C 的长度。',
        'R_WC 将 C 坐标表示转换为 W 坐标表示。这里讨论刚体旋转，不含缩放、透视投影或图像畸变。'),
      step('translation', '再加上原点的偏移', '从世界原点出发，把橙、蓝两根箭头首尾相接。',
        sub('p','W') + op('=') + sub('R','WC') + sub('p','C') + op('+') + sub('t','WC'),
        'p 下标 W 等于 R 下标 WC 乘 p 下标 C，再加 t 下标 WC。',
        't_WC 是相机原点在世界坐标系中的位置，方向是 W 原点到 C 原点。'),
      step('chain', '把相机、世界、基座接起来', '按“相机 → 世界 → 基座”依次换算。',
        sub('T','BC') + op('=') + sub('T','BW') + sub('T','WC'),
        'T 下标 BC 等于 T 下标 BW 乘 T 下标 WC；作用顺序从右往左。',
        'T_AB 的下标表示“把 B 中的表达换成 A 中的表达”。二维使用 3×3 齐次矩阵，三维使用 4×4；矩阵顺序不能任意交换。'),
    ],
  },
  {
    id: 'inverse_kinematics', title: '逆运动学', english: 'INVERSE KINEMATICS',
    question: '知道焊枪要去哪里，关节应该怎么转？',
    summary: '从两根连杆出发，看误差如何变成一次次角度修正。',
    source: { title: 'Modern Robotics · 数值逆运动学', url: 'https://modernrobotics.northwestern.edu/nu-gm-book-resource/6-2-numerical-inverse-kinematics-part-1-of-2/' },
    steps: [
      step('forward', '先看角度怎样决定位置', '杆长固定，第二根连杆的方向由两个关节角共同决定。',
        stack(
          v('x') + op('=') + sub('l','1') + fn('cos', sub('q','1')) + op('+') + sub('l','2') + fn('cos', sub('q','1') + op('+') + sub('q','2')),
          v('y') + op('=') + sub('l','1') + fn('sin', sub('q','1')) + op('+') + sub('l','2') + fn('sin', sub('q','1') + op('+') + sub('q','2')),
        ),
        'x 等于 l 一乘 cos q 一，加 l 二乘 cos 括号 q 一加 q 二；y 使用相同结构的 sin。',
        '平面二转动关节模型：q₁ 相对基座 x 轴，q₂ 相对第一连杆；基座固定，连杆刚性，长度为 l₁、l₂。'),
      step('error', '给定目标，先量出差距', '虚线连接当前末端与目标，表示位置误差。',
        v('e') + op('=') + sub('p','d') + op('−') + fn('f', v('q')),
        '位置误差 e 等于目标位置 p 下标 d，减去当前关节角 q 对应的末端位置 f 括号 q。',
        'p_d 是目标位置，q 是关节角向量，f(q) 是正运动学。此处仅求位置；焊枪朝向需要额外的姿态约束。'),
      step('iterate', '小步转动，再量一次', '雅可比矩阵只描述当前姿态附近的小变化。',
        v('Δp') + op('≈') + fn('J', v('q')) + v('Δq'),
        '末端的小变化 Δp 近似等于当前姿态的雅可比矩阵 J 括号 q，乘关节的小变化 Δq。',
        '动画使用带阻尼和步幅限制的数值迭代。误差下降是本例的计算结果；一般问题可能受初值、奇异位形和不可达目标影响而不收敛。'),
      step('solutions', '同一点，可以有不同的到法', '圆环只表示理想两连杆的位置可达范围。',
        row(op('|') + sub('l','1') + op('−') + sub('l','2') + op('|')) + op('≤') + norm(v('p')) + op('≤') + sub('l','1') + op('+') + sub('l','2'),
        '末端到基座的距离，介于两根杆长之差的绝对值和两根杆长之和之间。',
        '可达环以基座为原点，假定两个转动关节无角度限制、仅要求末端位置，不计障碍物；边界处两种肘部解可能重合。'),
    ],
  },
  {
    id: 'pointnet', title: 'PointNet++', english: 'HIERARCHICAL POINT FEATURES',
    question: '一片散乱的点，怎样表达局部形状？',
    summary: '选中心、找邻居、汇聚特征，从局部逐层看向更大的范围。',
    source: { title: 'PointNet++ · 作者项目页', url: 'https://web.stanford.edu/~rqi/pointnet2/' },
    steps: [
      step('cloud', '点没有网格，位置仍有结构', '输入是空间点集，编号顺序不代表几何关系。',
        v('P') + op('=') + op('{') + sub('p','1') + op(',') + op('…') + op(',') + sub('p','N') + op('}'),
        '点集 P 包含 p 一到 p 下标 N；每个点包含三维空间坐标。',
        '演示是几何点集与层级结构，不是相机实测数据。顺序无关是集合汇聚的设计要求，不意味着网络天然具有旋转不变性。'),
      step('sample', '让中心点尽量铺开', '比较每个候选点到“最近已选中心”的距离。',
        sub('c','new') + op('=') + under('arg max', v('p') + op('∈') + v('P') + op('∖') + v('S')) + under('min', v('c') + op('∈') + v('S')) + norm(v('p') + op('−') + v('c')),
        '新中心是这样的候选点：它到已选中心集合 S 的最近距离，在所有候选点中最大。',
        '首个中心预先固定，之后执行欧氏距离的迭代最远点采样。它是几何覆盖策略，不是学出的重要性排序。'),
      step('group', '用三维距离找邻居', '半径决定观察范围；屏幕上挨得近，空间中未必近。',
        sub('N','r') + paren(v('c')) + op('=') + op('{') + v('p') + op('∈') + v('P') + op(':') + norm(v('p') + op('−') + v('c')) + op('≤') + v('r') + op('}'),
        '中心 c 的半径 r 邻域，包含点集 P 中与 c 的欧氏距离不超过 r 的点。',
        '本图展示半径内的全部几何邻居。网络实现可设置邻居数量上限；PointNet++ 还可组合多个尺度，应对点密度变化。'),
      step('features', '把一群点变成局部特征', '先汇聚每个邻域，再让下一层组合更大范围。',
        sub('h','c') + op('=') + under('max', v('p') + op('∈') + sub('N','r') + paren(v('c'))) + fn('MLP', v('p') + op('−') + v('c')),
        '局部特征 h 下标 c，等于邻域内各点相对坐标经过共享 MLP 后，逐通道取最大值。',
        '公式简写的是仅有位置输入时的首层局部特征；后续层还使用前层特征。最大池化按通道取值，并非挑出一个完整的“最大点”。'),
    ],
  },
  {
    id: 'planning', title: '碰撞与路径规划', english: 'COLLISION & PATH PLANNING',
    question: '两点之间，直线一定能走吗？',
    summary: '先把物体大小算进去，再找通路，最后检查整条路径。',
    source: { title: 'Modern Robotics · 运动规划', url: 'https://modernrobotics.northwestern.edu/chapters/chapter10/' },
    steps: [
      step('collision', '端点安全，中途仍会碰撞', '判断碰撞时，要把整个物体的大小算进去。',
        v('d') + op('>') + sub('r','o') + op('+') + sub('r','b'),
        '两个圆形物体完全分离时，中心距离 d 大于障碍半径 r 下标 o 加运动圆盘半径 r 下标 b。',
        '这里只讨论固定半径圆盘在平面中的平移。等号表示接触；真实机械臂需要检查全部连杆与附件。'),
      step('clearance', '把大小折算成禁入区', '橙色边界已包含圆盘半径和预留间隙。',
        v('R') + op('=') + sub('r','o') + op('+') + sub('r','b') + op('+') + v('δ'),
        '扩张半径 R 等于障碍半径，加运动圆盘半径，再加预留间隙 δ。',
        '这项半径相加的简化适用于圆形障碍与平移圆盘。机械臂的关节构型空间更复杂，不能只膨胀障碍后规划枪尖。'),
      step('search', '让搜索朝目标推进', 'A* 同时比较已知路径代价与剩余距离估计。',
        fn('f', v('n')) + op('=') + fn('g', v('n')) + op('+') + fn('h', v('n')),
        '候选节点 n 的估计总代价 f，等于已知路径代价 g，加到目标的启发式估计 h。',
        '本例为八邻接网格、欧氏长度边代价及同尺度的欧氏距离启发式；每条候选边都检查间隙。A* 是教学示例，不代表工作坊的实际规划器。'),
      step('validate', '检查整段，才能真正通过', '缩短折线以后，连接线段仍要满足相同的间隙。',
        sub('d','min') + op('≥') + v('δ'),
        '整条路径上，运动物体表面与障碍表面的最小间隙 d 下标 min，至少为预留间隙 δ。',
        '本例利用线段到圆心的最近距离作连续几何检查；路径简化只缩短可直接连接的折线，不保证全局最优，也不计算动力学轨迹。'),
    ],
  },
];

const HEADLINES={
  coordinates:[['同一个点','两种坐标'],['先转方向','长度不变'],['首尾相接','补上偏移'],['从相机','到机械臂']],
  inverse_kinematics:[['关节转动','末端移动'],['目标不动','量出差距'],['小步修正','逐渐靠近'],['同一个点','不止一解']],
  pointnet:[['从散点','读出形状'],['选出中心','铺开视野'],['找到邻居','看见局部'],['逐层汇聚','理解结构']],
  planning:[['两端安全','途中呢？'],['绕开障碍','留出余量'],['朝向目标','搜索通路'],['整段检查','才能通过']],
};
for(const lesson of LESSONS){
  const recording=narration.topics[lesson.id];
  lesson.audio=recording?.audio;
  lesson.voice=narration.voice;
  lesson.steps.forEach((step,i)=>{
    const take=recording?.steps[i];
    if(take){
      step.speech=take.beats.map(b=>b.text).join('');
      step.beats=take.beats;
      step.seconds=take.seconds;
      step.audio=take.audio;
    }
    step.headline=HEADLINES[lesson.id][i];
  });
}

export const lessonById = (id) => LESSONS.find(lesson => lesson.id === id);
export const lessonDuration = (lesson) => lesson.steps.reduce((sum, s) => sum + s.seconds, 0);
export function beatAt(step,seconds){
  if(!step.beats?.every(b=>b.seconds>0))return {index:0,progress:seconds/step.seconds,visualProgress:Math.min(1,seconds/step.seconds)};
  let left=Math.max(0,seconds);
  for(let index=0;index<step.beats.length;index++){
    const beat=step.beats[index];
    if(left<beat.seconds||index===step.beats.length-1){
      const progress=Math.min(1,left/beat.seconds);
      return {index,progress,visualProgress:(index+progress)/step.beats.length};
    }
    left-=beat.seconds;
  }
}
export function lessonFrame(lesson, time) {
  let remaining = Math.max(0, time);
  for (let index = 0; index < lesson.steps.length; index++) {
    const step = lesson.steps[index];
    if (remaining < step.seconds || index === lesson.steps.length - 1)
      return { index, step, progress: Math.min(1, remaining / step.seconds),...{beat:beatAt(step,remaining)} };
    remaining -= step.seconds;
  }
}
