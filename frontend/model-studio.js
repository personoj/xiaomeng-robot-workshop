import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createXiaomengH, createPipePanel, ASSET_ROOT, HOME_POSE, JOINT_LIMITS } from './welding-model.js';
import { sampleMotion, MOTION_DURATION } from './welding-motion.js';
import { CABLE_LENGTHS } from './cable-constraints.js';
import { setPanelWeldPreview, clearPanelWeldTrace } from './tube-panel-model.js';

T.Object3D.DEFAULT_UP.set(0,0,1);
const $=id=>document.getElementById(id);
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.04;
$('viewport').appendChild(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#eae9e5');
const pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;
scene.environmentIntensity=.58;
const camera=new T.PerspectiveCamera(36,innerWidth/innerHeight,.01,150);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
controls.minDistance=.12;controls.maxDistance=15;controls.maxPolarAngle=Math.PI*.49;
const sun=new T.DirectionalLight('#fff3dc',3.0);sun.position.set(-3,-4,8);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-2.6,right:2.6,top:3,bottom:-2.6,near:.1,far:20});sun.shadow.normalBias=.005;sun.shadow.radius=2;scene.add(sun);
const fill=new T.DirectionalLight('#e4edff',1.6);fill.position.set(4,2,5);scene.add(fill);
const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:'#e5e4df',roughness:.87,metalness:.04}));
floor.position.z=-.018;floor.receiveShadow=true;scene.add(floor);
const grid=new T.GridHelper(12,48,'#d3d5cf','#dcddd7');grid.rotation.x=Math.PI/2;grid.position.z=-.014;grid.material.transparent=true;grid.material.opacity=.30;scene.add(grid);
const target=new T.WebGLRenderTarget(innerWidth,innerHeight,{type:T.HalfFloatType,samples:4});
const composer=new EffectComposer(renderer,target);composer.setPixelRatio(Math.min(devicePixelRatio,1.5));
composer.addPass(new RenderPass(scene,camera));
const ao=new GTAOPass(scene,camera,innerWidth,innerHeight);
ao.updateGtaoMaterial({radius:.19,distanceExponent:1.4,thickness:.35,samples:12,scale:.8});
ao.updatePdMaterial({radius:4,samples:8});ao.blendIntensity=.72;composer.addPass(ao);
composer.addPass(new OutputPass());
let assembly,panel,selected='machine';
const pose=[...HOME_POSE];
const motion={playing:false,elapsed:0,cycles:0,frames:0,maxError:0,reason:'',lastCheckMs:0};
let lastFrame=0,frameAccumulator=0;
function syncControls(){
  [...$('joint-controls').children].forEach((l,i)=>{l.querySelector('input').value=pose[i];l.querySelector('output').textContent=pose[i].toFixed(1)+'°';});
}
function updateMotionUI(result){
  $('motion-monitor').hidden=false;document.body.classList.add('motion-visible');
  $('motion-toggle').textContent=motion.playing?'暂停运动':'播放运动';
  $('motion-status').textContent=result?.ok===false?'已阻止不满足约束的姿态':motion.playing?'正在检查运动':'运动已暂停';
  $('motion-monitor').classList.toggle('blocked',result?.ok===false);
  $('motion-time').textContent=motion.elapsed.toFixed(1)+' / '+MOTION_DURATION+' s';
  $('motion-error').textContent=(motion.maxError*1000).toFixed(3)+' mm';
  $('motion-detail').textContent=result?.ok===false?result.reason:'接头锁定 · 定长管线 · 碰撞约束';
}
function applyMotionPose(next){
  const start=performance.now(),result=assembly.setPose(next);motion.lastCheckMs=performance.now()-start;
  pose.splice(0,6,...assembly.joints.map(j=>j.userData.angleDeg));syncControls();
  if(result.ok){motion.reason='';motion.frames++;motion.maxError=Math.max(motion.maxError,...result.cables.map(c=>Math.abs(c.error)));}
  else{motion.playing=false;motion.reason=result.reason;}
  updateMotionUI(result);return result;
}
function visibleObject(){return selected==='arm'?assembly.arm:selected==='panel'?panel:assembly.root;}
function setView(view) {
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const bounds=new T.Box3().setFromObject(visibleObject()),c=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3());
  let span=Math.max(size.x,size.y,size.z)*(selected==='machine'?2.27:2.0);
  const dirs={perspective:[-.95,-1.85,.86],side:[0,-1,.2],front:[-1,0,.20],rear:[1,0,.35],top:[0,-.001,1],torch:[-1,-1,-.15],feeder:[-.65,1,.7],spool:[1,-.45,.45],inlet:[.35,-1,.25],driver:[-1,-1,.8]};
  let target=c;
  if(selected==='machine'&&view!=='torch'&&view!=='top')target.z-=.18;
  const panelDetail=selected==='panel'&&['pipe-end','seam'].includes(view);
  const detail=panelDetail||(selected!=='panel'&&['torch','feeder','spool','inlet','driver'].includes(view));
  if(detail&&!panelDetail){
    const obj=view==='torch'?assembly.accessories.torch:view==='feeder'?assembly.accessories.feeder:view==='spool'?assembly.accessories.spool:view==='inlet'?assembly.accessories.basePort:assembly.root.getObjectByName('suspension-seat');
    const box=new T.Box3().setFromObject(obj);target=box.getCenter(new T.Vector3());
    span=view==='torch'?1.12:view==='feeder'?1.02:view==='spool'?1.65:view==='inlet'?.85:2.6;
    if(view==='driver'){target.x-=.27;target.z-=.06;}
  }
  if(selected==='panel'){
    dirs.perspective=[-1.45,-1.1,1.5];dirs.front=[-1,0,.13];dirs.rear=[1,0,.2];
    dirs['pipe-end']=[-1.35,-.6,.72];dirs.seam=[-.45,-.55,1.5];
    if(view==='perspective')span=4.12;
    if(view==='front'||view==='rear')span=3.15;
    if(panelDetail){
      target=panel.localToWorld(new T.Vector3(view==='pipe-end'?-panel.userData.length/2+.11:-.83,-panel.userData.pitch*.8,.012));
      span=view==='pipe-end'?1.05:.68;
    }
  }
  document.body.classList.toggle('detail-view',detail);
  document.querySelector('.header-caption').textContent=detail?({torch:'焊枪 · 空心气嘴与焊丝',feeder:'送丝机构 · 滚轮与接头',spool:'线盘 · 支撑轴与独立管线',inlet:'基座接头 · 法兰与密封安装面',driver:'驾驶位 · 座椅与脚踏','pipe-end':'管口 · 壁厚与切口倒角',seam:'管间连接 · 短条状焊道'})[view]:selected==='panel'?'钢管管排 · 工件预览':'焊接机器人 · 模型预览';
  controls.maxPolarAngle=detail?Math.PI*.72:Math.PI*.49;
  const dir=new T.Vector3(...(dirs[view]||[-1,-1,.5])).normalize();
  camera.position.copy(target).addScaledVector(dir,span);controls.target.copy(target);controls.update();
}
function chooseObject(name){
  selected=name;assembly.root.visible=name!=='panel';assembly.base.visible=name==='machine';panel.visible=name==='panel';
  document.querySelectorAll('[data-object]').forEach(b=>b.classList.toggle('active',b.dataset.object===name));
  $('model-title').innerHTML=name==='panel'?'钢管管排<span>密排钢管 · 管间焊接</span>':name==='arm'?'FANUC<span>M-10iD/8L · 六轴机械臂</span>':'小萌 H<span>轮式焊接机器人</span>';
  $('model-caption').textContent=name==='panel'?'整齐装配 · 焊前 / 焊后对照':'真实六轴机械臂 · 画册外观重建';
  $('specs-content').innerHTML=name==='panel'?'<div><b>08</b><span>平行钢管</span></div><div><b>2400<small> mm</small></b><span>示意长度</span></div><div><b>76<small> mm</small></b><span>示意外径</span></div>':'<div><b>06</b><span>机械臂轴数</span></div><div><b>2032<small> mm</small></b><span>额定臂展</span></div><div><b>8<small> kg</small></b><span>腕部额定负载</span></div>';
  document.querySelector('.spec-note').textContent=name==='panel'?'尺寸为演示选值 · 壁厚 4 mm':'机械臂参数来自厂家资料';
  $('download').href=ASSET_ROOT+(name==='panel'?'tube-panel.glb':name==='arm'?'fanuc-m10id-8l-welding.glb':'xiaomeng-h.glb');
  $('pose-toggle').hidden=name==='panel';$('joints').hidden=true;
  $('motion-toggle').hidden=name==='panel';
  if(name==='panel'){motion.playing=false;$('motion-monitor').hidden=true;document.body.classList.remove('motion-visible');}
  document.querySelector('[data-view="torch"]').hidden=name==='panel';setView('perspective');
  document.querySelector('[data-view="feeder"]').hidden=name==='panel';
  document.querySelector('[data-view="spool"]').hidden=name==='panel';
  document.querySelector('[data-view="inlet"]').hidden=name==='panel';
  document.querySelector('[data-view="driver"]').hidden=name!=='machine';
  document.querySelector('[data-view="pipe-end"]').hidden=name!=='panel';
  document.querySelector('[data-view="seam"]').hidden=name!=='panel';
  $('panel-state').hidden=name!=='panel';
  if(name==='panel')choosePanelState('before');
}
function choosePanelState(state){
  const welded=state==='after';clearPanelWeldTrace(panel);setPanelWeldPreview(panel,welded);
  document.querySelectorAll('[data-panel-state]').forEach(b=>{b.classList.toggle('active',b.dataset.panelState===state);b.setAttribute('aria-pressed',String(b.dataset.panelState===state));});
  $('panel-state-note').textContent=welded?'焊后外观预览 · 短条状焊道':'未焊接 · 钢管紧密排列';
  $('download').href=ASSET_ROOT+(welded?'tube-panel-welded.glb':'tube-panel.glb');
}
async function main(){
  for(const [id,name] of [['motion-main-length','corrugated-main-hose'],['motion-red-length','red-supply-hose'],['motion-wire-length','wire-feed-guide']])$(id).textContent=CABLE_LENGTHS[name].toFixed(3)+' m';
  const loader=new GLTFLoader(),font=await new FontLoader().loadAsync(ASSET_ROOT+'helvetiker_regular.typeface.json');
  assembly=await createXiaomengH({loadLink:async name=>(await loader.loadAsync(ASSET_ROOT+name+'.glb')).scene,font});
  scene.add(assembly.root);panel=createPipePanel();panel.position.z=.18;panel.visible=false;scene.add(panel);
  document.querySelectorAll('[data-object]').forEach(b=>b.onclick=()=>chooseObject(b.dataset.object));
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
  document.querySelectorAll('[data-panel-state]').forEach(b=>b.onclick=()=>choosePanelState(b.dataset.panelState));
  $('pose-toggle').onclick=()=>{$('joints').hidden=!$('joints').hidden;$('info').hidden=true;};
  for(let i=0;i<6;i++){
    const label=document.createElement('label');label.innerHTML=`<span>J${i+1}</span><input type="range" aria-label="关节 J${i+1}" min="${Math.ceil(JOINT_LIMITS[i][0])}" max="${Math.floor(JOINT_LIMITS[i][1])}" step="1" value="${pose[i]}"><output>${pose[i]}°</output>`;
    label.querySelector('input').oninput=e=>{motion.playing=false;motion.elapsed=0;const next=[...pose];next[i]=Number(e.target.value);applyMotionPose(next);};
    $('joint-controls').appendChild(label);
  }
  $('home-pose').onclick=()=>{motion.playing=false;motion.elapsed=0;applyMotionPose(HOME_POSE);setView('perspective');};
  $('motion-toggle').onclick=()=>{
    if(motion.playing){motion.playing=false;updateMotionUI();return;}
    if(motion.elapsed===0||motion.reason){motion.reason='';motion.elapsed=0;if(!applyMotionPose(HOME_POSE).ok)return;}
    motion.playing=true;lastFrame=performance.now();frameAccumulator=0;updateMotionUI();
  };
  chooseObject('machine');$('loading').hidden=true;
  // Read-only diagnostics for review; no physical robot or speech session is connected.
  window.modelReview={get status(){return {selected,joints:assembly.joints.length,angles:assembly.joints.map(j=>j.userData.angleDeg),motion:{...motion},safety:assembly.motionStatus,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,loaded:true};}};
}
$('info-toggle').onclick=()=>{$('info').hidden=!$('info').hidden;$('info-toggle').setAttribute('aria-expanded',String(!$('info').hidden));$('joints').hidden=true;};
$('info-close').onclick=()=>{$('info').hidden=true;$('info-toggle').setAttribute('aria-expanded','false');};
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);});
renderer.setAnimationLoop(now=>{
  const dt=lastFrame?Math.min((now-lastFrame)/1000,.05):0;lastFrame=now;
  if(assembly&&motion.playing){
    frameAccumulator+=dt;
    if(frameAccumulator>=1/30){
      const next=Math.min(MOTION_DURATION,motion.elapsed+frameAccumulator);frameAccumulator=0;
      if(applyMotionPose(sampleMotion(next)).ok){motion.elapsed=next;if(next>=MOTION_DURATION){motion.cycles++;motion.elapsed=0;}}
    }
  }
  controls.update();composer.render();
});
main().catch(e=>{$('loading').textContent='模型加载失败，请刷新重试。';console.error(e);});
