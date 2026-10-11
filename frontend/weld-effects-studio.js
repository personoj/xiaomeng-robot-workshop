import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createWeldingEffects } from './welding-effects.js';
import {createPipePanel,appendPanelWeldContact} from './tube-panel-model.js';

T.Object3D.DEFAULT_UP.set(0,0,1);
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
document.getElementById('viewport').appendChild(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#252b2c');scene.fog=new T.Fog('#252b2c',2.7,6);
const room=new RoomEnvironment(),pmrem=new T.PMREMGenerator(renderer);
const environment=pmrem.fromScene(room,.04);room.dispose();pmrem.dispose();
scene.environment=environment.texture;scene.environmentIntensity=.26;
const camera=new T.PerspectiveCamera(38,1,.006,10);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
controls.minDistance=.12;controls.maxDistance=2.8;
const warm=new T.DirectionalLight('#ffdbad',2.3);warm.position.set(-1,-2,3);warm.castShadow=true;
warm.shadow.mapSize.set(1024,1024);warm.shadow.camera.left=-.6;warm.shadow.camera.right=.6;
warm.shadow.camera.top=.6;warm.shadow.camera.bottom=-.6;warm.shadow.camera.near=.1;warm.shadow.camera.far=5;
warm.shadow.normalBias=.002;scene.add(warm);
scene.add(new T.HemisphereLight('#a5b7c7','#201b17',.72));
const fill=new T.DirectionalLight('#b3c5da',.95);fill.position.set(.7,-1,.8);scene.add(fill);
const steel=new T.MeshStandardMaterial({color:'#53585b',roughness:.80,metalness:.76});
const oxide=new T.MeshStandardMaterial({color:'#74604a',roughness:.95,metalness:.30});
const graphite=new T.MeshStandardMaterial({color:'#1c252a',roughness:.62,metalness:.5});
const brass=new T.MeshStandardMaterial({color:'#a88453',roughness:.45,metalness:.84});
const yellow=new T.MeshStandardMaterial({color:'#d0a323',roughness:.50,metalness:.18});
const pipeSurface=new Uint8Array(128*128*4);
let rand=9381;function random(){rand=(Math.imul(rand,1664525)+1013904223)>>>0;return rand/4294967296;}
for(let y=0;y<128;y++)for(let x=0;x<128;x++){
  const i=(y*128+x)*4,grain=random(),patch=Math.sin(x*.086)*Math.cos(y*.047),v=88+grain*21+patch*9;
  pipeSurface[i]=v+Math.max(0,patch)*9;pipeSurface[i+1]=v;pipeSurface[i+2]=v-3;pipeSurface[i+3]=255;
}
const texture=new T.DataTexture(pipeSurface,128,128,T.RGBAFormat);texture.colorSpace=T.SRGBColorSpace;
texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(3,4);texture.needsUpdate=true;
steel.map=texture;steel.color.set('#ffffff');
function mesh(g,m,p){const o=new T.Mesh(g,m);o.position.fromArray(p);o.castShadow=o.receiveShadow=true;scene.add(o);return o;}
function cylinder(a,b,r1,r2,material){
  const va=new T.Vector3(...a),vb=new T.Vector3(...b),delta=vb.clone().sub(va);
  const o=mesh(new T.CylinderGeometry(r1,r2,delta.length(),32),material,va.clone().add(vb).multiplyScalar(.5).toArray());
  o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());return o;
}
// A short, upright tube panel. This scene inspects optics only, not robot kinematics.
const pitch=.0768,seamHeight=.0178;
const workpiece=createPipePanel({length:1,count:5});workpiece.rotation.x=Math.PI/2;workpiece.position.z=.12+2*pitch;scene.add(workpiece);
// A deposited bridge follows the actual groove; no sphere sits outside the tubes.
for(let i=0;i<=12;i++)appendPanelWeldContact(workpiece,{seamId:'long-seam-3',position:[.024+i*.001,pitch/2,seamHeight],arcOn:true});
appendPanelWeldContact(workpiece,{arcOn:false});
const contact=new T.Vector3(.03,-seamHeight,.12+pitch*2.5);
const nozzleDirection=new T.Vector3(-.20,-1,.12).normalize();
const nozzle=contact.clone().addScaledVector(nozzleDirection,.020);
const neck=nozzle.clone().addScaledVector(nozzleDirection,.058);
const handle=neck.clone().addScaledVector(nozzleDirection,.072);
cylinder(nozzle.toArray(),neck.toArray(),.010,.008,brass);
cylinder(neck.toArray(),handle.toArray(),.014,.020,graphite);
const bend=handle.clone().add(new T.Vector3(-.045,-.008,.029));
cylinder(handle.toArray(),bend.toArray(),.019,.023,graphite);
const armEnd=bend.clone().add(new T.Vector3(-.095,.015,.01));
cylinder(bend.toArray(),armEnd.toArray(),.035,.048,graphite);
cylinder(armEnd.toArray(),armEnd.clone().add(new T.Vector3(-.17,.025,.04)).toArray(),.037,.049,yellow);
// Rim/lip with a dark centre distinguishes the nozzle from a glowing solid cap.
const mouth=mesh(new T.TorusGeometry(.0076,.0010,8,32),graphite,nozzle.toArray());
mouth.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),nozzleDirection);
cylinder(contact.clone().addScaledVector(nozzleDirection,.0015).toArray(),nozzle.toArray(),.0006,.0006,brass).name='projecting-weld-wire';
const ground=mesh(new T.PlaneGeometry(20,20),new T.MeshStandardMaterial({color:'#302e29',roughness:.96}),[0,0,.017]);
ground.receiveShadow=true;
const back=mesh(new T.PlaneGeometry(6,3),new T.MeshStandardMaterial({color:'#4b443c',roughness:.98}),[0,.34,1.48]);
back.rotation.x=Math.PI/2;
const fx=createWeldingEffects({scene,up:[0,0,1],wind:[.066,-.018,0]});
let arcOn=true,lastTime=0,stats;
function setView(name){
  const dirs={photo:[.48,-.40,.075],detail:[.25,-.20,.025],wide:[.70,-1.0,.29]};
  camera.position.copy(contact).add(new T.Vector3(...dirs[name]));
  controls.target.copy(contact).add(new T.Vector3(name==='wide'?-.04:0,0,name==='photo'?.032:0));controls.update();
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
document.getElementById('arc-toggle').addEventListener('click',()=>{
  arcOn=!arcOn;document.getElementById('arc-toggle').textContent=arcOn?'停止起弧':'开始起弧';
  document.getElementById('arc-state').textContent=arcOn?'正在起弧':'已停弧 · 烟羽消散';
  document.getElementById('status').dataset.off=String(!arcOn);
});
function resize(){
  renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  fx.setViewport(renderer.domElement.height,camera.fov);
}
addEventListener('resize',resize);resize();setView('photo');
renderer.setAnimationLoop(ms=>{
  const dt=lastTime?Math.max(0,(ms-lastTime)/1000):0;lastTime=ms;
  stats=fx.update({point:contact,direction:nozzleDirection,arcOn,dt,camera,occluders:scene.children.filter(o=>o!==fx.root)});
  document.getElementById('viewport').dataset.arcOccluder=stats.occluder||'';
  controls.update();renderer.render(scene,camera);
  document.getElementById('metrics').textContent=`短火星 ${stats.activeSparks} / 烟羽 ${stats.activeSmoke} · 拖动检查角度`;
});
window.addEventListener('pagehide',()=>{
  renderer.setAnimationLoop(null);fx.dispose();controls.dispose();
  scene.traverse(o=>{if(o.isMesh){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];for(const m of materials)m.dispose();}});
  texture.dispose();environment.dispose();renderer.dispose();
},{once:true});
