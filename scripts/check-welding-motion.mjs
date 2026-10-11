import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { createXiaomengH, HOME_POSE } from '../frontend/welding-model.js';
import { CABLE_LENGTHS } from '../frontend/cable-constraints.js';
import { sampleMotion, MOTION_DURATION } from '../frontend/welding-motion.js';

const folder='frontend/public/models/xiaomeng-h/',loader=new GLTFLoader();
let baseLink;
const font=new FontLoader().parse(JSON.parse(await fs.readFile(folder+'helvetiker_regular.typeface.json','utf8')));
const model=await createXiaomengH({font,loadLink:async name=>{
  const b=await fs.readFile(folder+name+'.glb');
  const link=(await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;
  if(name==='base')baseLink=link;return link;
}});
const measures={frames:0,maxIndependentLengthErrorMetres:0,maxConnectorErrorMetres:0,minBendRadiusMetres:{},totalMs:0};
const anchorDefs=[
  ['corrugated-main-hose',0,model.accessories.feeder,[-.065,.205,.048]],
  ['corrugated-main-hose',1,model.accessories.basePort,[-.059,0,0]],
  ['red-supply-hose',0,model.accessories.feeder,[-.1975,0,.041]],
  ['red-supply-hose',1,model.root,[-.06,.20,1.014]],
  ['wire-feed-guide',0,model.accessories.spool,[0,0,.159]],
  ['wire-feed-guide',1,model.accessories.feeder,[.178,0,.041]],
];
const start=performance.now();
for(let frame=0;frame<=720;frame++){
  const result=model.setPose(sampleMotion(frame/720*MOTION_DURATION));
  assert.ok(result.ok,`frame ${frame}: ${result.reason}`);
  for(const cable of model.cableState){
    let sum=0,previous=cable.curve.getPoint(0),p=new T.Vector3();
    for(let i=1;i<=4096;i++){cable.curve.getPoint(i/4096,p);sum+=p.distanceTo(previous);previous.copy(p);}
    const error=Math.abs(sum-CABLE_LENGTHS[cable.name]);
    measures.maxIndependentLengthErrorMetres=Math.max(measures.maxIndependentLengthErrorMetres,error);
    assert.ok(error<.0002,`${cable.name} stretched`);
  }
  for(const [name,t,target,point] of anchorDefs){
    const tube=model.root.getObjectByName(name),actual=tube.localToWorld(tube.geometry.parameters.path.getPoint(t));
    const expected=target.localToWorld(new T.Vector3(...point)),error=actual.distanceTo(expected);
    measures.maxConnectorErrorMetres=Math.max(measures.maxConnectorErrorMetres,error);assert.ok(error<1e-7,`${name} detached`);
  }
  for(const c of result.cables)measures.minBendRadiusMetres[c.name]=Math.min(measures.minBendRadiusMetres[c.name]??Infinity,c.bend);
  measures.frames++;
}
measures.totalMs=performance.now()-start;
const rejected=[];
for(const pose of [[150,-62,-62,0,-90,0],[0,120,-62,0,-90,0],[0,-62,210,0,-90,0]]){
  const before=model.joints.map(j=>j.userData.angleDeg),result=model.setPose(pose);
  assert.equal(result.ok,false,'Deliberately unreachable/colliding pose should be blocked');
  assert.deepEqual(model.joints.map(j=>j.userData.angleDeg),before,'Rejected move changed the accepted pose');
  rejected.push({pose,reason:result.reason});
}
assert.ok(model.setPose(HOME_POSE).ok);
const ray=new T.Raycaster(),mount=model.accessories.basePort;
baseLink.traverse(o=>{if(o.isMesh)o.material.side=T.DoubleSide;});
let maxMountSurfaceStep=0;
for(let i=0;i<8;i++){
  const a=i*Math.PI/4,y=Math.cos(a)*.040,z=Math.sin(a)*.040;
  const origin=mount.localToWorld(new T.Vector3(-.035,y,z));
  ray.set(origin,new T.Vector3(1,0,0).transformDirection(mount.matrixWorld));
  const hit=ray.intersectObject(baseLink,true)[0];assert.ok(hit,'Mounting flange faces empty space');
  const depth=mount.worldToLocal(hit.point.clone()).x;
  maxMountSurfaceStep=Math.max(maxMountSurfaceStep,depth);
  assert.ok(depth>=0&&depth<=.003,'Base surface must fall within the compressed gasket depth');
}
const text=model.root.getObjectByName('label-WELDING WIRE'),p=new T.Vector3();text.updateMatrix();
for(let i=0;i<text.geometry.attributes.position.count;i++){
  p.fromBufferAttribute(text.geometry.attributes.position,i).applyMatrix4(text.matrix);
  assert.ok(Math.hypot(p.x,p.z)<.170,'Reel lettering extends off the disc');
  assert.ok(p.y>=.073&&p.y<.076,'Reel lettering is floating off the surface');
}
const report={...measures,rejected,letteringWithinDisc:true,mountingSurfaceWithinGasket:true,maxMountSurfaceDepthMetres:maxMountSurfaceStep,scope:'24-second six-axis cycle at 30Hz, with <=0.5deg angular substeps. Fixed-length quasi-static curves, capsule/triangle and mesh collisions; not a material-dynamics certification.'};
await fs.writeFile(folder+'motion-validation.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
