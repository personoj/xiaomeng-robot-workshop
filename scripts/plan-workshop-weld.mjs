import fs from 'node:fs/promises';
import * as T from 'three';
import {loadWeldingModel} from './welding-model-loader.mjs';
import {HOME_POSE} from '../frontend/welding-model.js';
import {weldIK,weldFK} from '../frontend/welding-kinematics.js';
import {createPipePanel} from '../frontend/tube-panel-model.js';
import {parkingForPanel,STITCH_PATTERN} from '../frontend/workshop-layout.js';

const spec=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const m=await loadWeldingModel({renderCables:false,cableShapeCacheSize:1024}),frames=[],obstacles=[];
for(const p of spec.panels){
  const panel=createPipePanel();panel.rotation.x=Math.PI/2;panel.position.fromArray(p.position);panel.updateMatrixWorld(true);
  panel.traverse(o=>{if(o.isMesh&&!o.parent.name.includes('deposit'))obstacles.push(o);});
  for(const x of [-.82,.82]){
    obstacle('管排立柱',[.055,.055,1.35],[p.position[0]+x,p.position[1]+.13,p.position[2]-.55]);
    obstacle('管排底脚',[.13,.46,.07],[p.position[0]+x,p.position[1]+.27,p.position[2]-1.215]);
  }
}
function obstacle(name,size,position){const mesh=new T.Mesh(new T.BoxGeometry(...size));mesh.name=name;mesh.position.fromArray(position);mesh.updateMatrixWorld(true);obstacles.push(mesh);}
obstacle('后墙',[24,.13,2.7],[5,3.9,1.35]);obstacle('抓取工作台',[1.3,1.05,.92],[-2.28,-.35,.46]);
m.setObstacles(obstacles);
const panel=spec.panel,[px,py,pz]=panel.position,number=spec.seam;
const seamId=`long-seam-${8-number}`,localY=(4-number)*.0768,crown=.0178;
let pose=spec.robot.pose||HOME_POSE,base=[...spec.robot.position],heading=spec.robot.heading||0;
let maxCableError=0,maxTipError=0,maxConnectorError=0;
function accept(q,b,h,phase,arc=false,seconds=.05){
  m.root.position.fromArray(b);m.root.rotation.z=h;
  const result=m.setPose(q);if(!result.ok)throw new Error(`${phase}: ${result.reason}`);
  const point=m.accessories.tcp.getWorldPosition(new T.Vector3());
  const dir=new T.Vector3(.72,0,.69).normalize().transformDirection(m.accessories.torch.matrixWorld).negate();
  const local=[point.x-px,point.z-pz,py-point.y];
  if(arc){
    const error=Math.hypot(local[1]-localY,local[2]-crown);maxTipError=Math.max(maxTipError,error);
    if(error>.0005||local[0]<-1.1751||local[0]>1.1751)throw new Error('枪尖偏离焊缝，拒绝起弧');
  }
  for(const c of m.cableState)maxCableError=Math.max(maxCableError,Math.abs(c.error));
  for(const [name,t,node,p] of [['corrugated-main-hose',0,m.accessories.feeder,[-.065,.205,.048]],['corrugated-main-hose',1,m.accessories.basePort,[-.059,0,0]],['red-supply-hose',0,m.accessories.feeder,[-.1975,0,.041]],['red-supply-hose',1,m.root,[-.06,.20,1.014]],['wire-feed-guide',0,m.accessories.spool,[0,0,.159]],['wire-feed-guide',1,m.accessories.feeder,[.178,0,.041]]]){
    const cable=m.cableState.find(c=>c.name===name),actual=m.arm.localToWorld(cable.curve.getPoint(t));
    maxConnectorError=Math.max(maxConnectorError,actual.distanceTo(node.localToWorld(new T.Vector3(...p))));
  }
  frames.push({pose:q,position:b,heading:h,phase,arc_on:arc,tcp:point.toArray(),direction:dir.toArray(),contact:arc?local:null,seconds});
  pose=[...q];base=[...b];heading=h;
}
function jointMove(target,phase){
  const from=[...pose],steps=Math.max(1,Math.ceil(Math.max(...target.map((q,i)=>Math.abs(q-from[i])))/.45));
  for(let i=1;i<=steps;i++){const t=i/steps,u=t*t*(3-2*t);accept(target.map((q,j)=>T.MathUtils.lerp(from[j],q,u)),[...base],heading,phase);}
}
// Plan all checked frames before mutating the persistent workshop.
accept(pose,base,heading,'positioning');
if(pose.some((q,i)=>Math.abs(q-HOME_POSE[i])>.1)){
  const initial=weldFK(pose);
  for(let i=1;i<=26;i++){
    const point=initial.point.clone().addScaledVector(initial.direction,-.065*i/26),r=weldIK(point.toArray(),initial.direction.toArray(),pose);
    if(!r.ok)throw new Error('当前枪姿无法安全退枪');accept(r.q,[...base],heading,'positioning');
  }
}
jointMove(HOME_POSE,'positioning');
// Retreat into the clear front aisle before taking a new bay; welding never
// translates or rotates the chassis. Vehicle heading follows its drive tangent.
if(base[1]>-.8){
  const start=[...base],end=[start[0],-1.4,0],steps=Math.ceil((start[1]+1.4)/.012);
  for(let i=1;i<=steps;i++)accept(pose,start.map((v,j)=>T.MathUtils.lerp(v,end[j],i/steps)),heading,'positioning');
}
const parking=parkingForPanel(panel),target=parking.position;
const start=[...base],distance=new T.Vector3(...start).distanceTo(new T.Vector3(...target)),handle=Math.min(.85,distance*.30);
const p1=[start[0]-handle*Math.cos(heading),start[1]-handle*Math.sin(heading),0];
const p2=[target[0],target[1]-handle,0];
const travelSteps=distance<.001?0:Math.max(25,Math.ceil(distance/.01));
for(let i=1;i<=travelSteps;i++){
  const t=i/travelSteps,u=t*t*(3-2*t),v=1-u;
  const b=start.map((x,j)=>v*v*v*x+3*v*v*u*p1[j]+3*v*u*u*p2[j]+u*u*u*target[j]);
  const dx=3*v*v*(p1[0]-start[0])+6*v*u*(p2[0]-p1[0])+3*u*u*(target[0]-p2[0]);
  const dy=3*v*v*(p1[1]-start[1])+6*v*u*(p2[1]-p1[1])+3*u*u*(target[1]-p2[1]);
  accept(pose,b,Math.atan2(dy,dx)-Math.PI,'positioning');
}
base=[...target];heading=parking.heading;
const lockedBase=[...base],lockedHeading=heading;
const direction=[-1,0,-.2];
const solve=(x,clearance=0,seed=pose)=>{
  const r=weldIK([-1.8+clearance,x+.03,pz+localY],direction,seed);
  if(!r.ok)throw new Error('固定底盘时当前焊点不可达');return r.q;
};
const clearPoses=[];
function at(x,clearance,phase,arc=false){accept(solve(x,clearance),[...lockedBase],lockedHeading,phase,arc,.04);if(clearance>=.0649)clearPoses.push([...pose]);}
const {count,length,firstCentre,lastCentre}=STITCH_PATTERN;
const spots=Array.from({length:count},(_,i)=>T.MathUtils.lerp(firstCentre,lastCentre,i/(count-1)));
const first=spots[0]+length/2;
solve(first,.065); // Reachability before moving the gun.
const entryStart=frames.length,entryHome=[...pose];
const startTip=weldFK(pose),goalPoint=new T.Vector3(-1.8+.065,first+.03,pz+localY),goalDirection=new T.Vector3(...direction).normalize();
const entrySteps=Math.ceil(startTip.point.distanceTo(goalPoint)/.004);
for(let i=1;i<=entrySteps;i++){
  const t=i/entrySteps,point=startTip.point.clone().lerp(goalPoint,t),dir=startTip.direction.clone().lerp(goalDirection,t).normalize();
  const r=weldIK(point.toArray(),dir.toArray(),pose);if(!r.ok)throw new Error('入枪过渡不可达');
  accept(r.q,[...lockedBase],lockedHeading,'approach');
}
const entryPoses=[entryHome,...frames.slice(entryStart).map(f=>f.pose)];clearPoses.push([...pose]);
for(let spot=0;spot<spots.length;spot++){
  const right=spots[spot]+length/2,left=spots[spot]-length/2;
  if(spot){
    const previous=spots[spot-1]-length/2,steps=Math.ceil(Math.abs(right-previous)/.006);
    for(let i=1;i<=steps;i++)at(T.MathUtils.lerp(previous,right,i/steps),.065,'indexing');
  }
  for(let i=1;i<=16;i++)at(right,.065*(1-i/16),'approach');
  // Short, disjoint stitches grow from accepted TCP travel, never from time.
  for(let i=0;i<=24;i++){at(T.MathUtils.lerp(right,left,i/24),0,'welding',true);frames.at(-1).stitch=spot+1;}
  for(let i=1;i<=16;i++)at(left,.065*i/16,'indexing');
}
// Retrace the already checked 65 mm stand-off corridor with the arc off, then
// reverse the entry path. This avoids a new wrist branch near a singularity.
for(const q of [...clearPoses].reverse())accept(q,[...lockedBase],lockedHeading,'withdraw');
for(const q of [...entryPoses].reverse())accept(q,[...lockedBase],lockedHeading,'withdraw');
const parkedFrames=frames.filter(f=>f.phase!=='positioning');
if(parkedFrames.some(f=>f.position.some((v,i)=>v!==lockedBase[i])||f.heading!==lockedHeading))throw new Error('焊接阶段底盘发生移动');
await fs.writeFile(process.argv[3],JSON.stringify({seam_id:seamId,seam:number,frames,pattern:STITCH_PATTERN,parking,validation:{base_locked:true,stitches:STITCH_PATTERN.count,frames:frames.length,max_cable_length_error:maxCableError,max_connector_error:maxConnectorError,max_tcp_error:maxTipError,collisions:0,scope:'Checked kinematic model, fixed-length cable curves and triangle collisions; not a physical welding process simulation'}}));
console.log(JSON.stringify({ok:true,frames:frames.length,maxCableError,maxConnectorError,maxTipError}));
