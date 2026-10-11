import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { Canvas, ImageData, loadImage } from '@napi-rs/canvas';
import { createXiaomengH, createPipePanel, HOME_POSE } from '../frontend/welding-model.js';
import { setPanelWeldPreview } from '../frontend/tube-panel-model.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'frontend/public/models/xiaomeng-h');
// Preserve standard PBR grain maps in the portable GLB, including Node readback.
globalThis.OffscreenCanvas=Canvas;globalThis.ImageData=ImageData;globalThis.self=globalThis;
globalThis.createImageBitmap=async blob=>loadImage(Buffer.from(await blob.arrayBuffer()));
globalThis.FileReader=class{
  readAsArrayBuffer(blob){blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}
  readAsDataURL(blob){blob.arrayBuffer().then(v=>{this.result=`data:${blob.type};base64,${Buffer.from(v).toString('base64')}`;this.onloadend?.();});}
};
const fontPath=path.join(root,'node_modules/three/examples/fonts/helvetiker_regular.typeface.json');
await fs.copyFile(fontPath,path.join(out,'helvetiker_regular.typeface.json'));
const font=new FontLoader().parse(JSON.parse(await fs.readFile(fontPath,'utf8')));
const loader=new GLTFLoader(),armMeshes=[];
const model=await createXiaomengH({font,loadLink:async(name)=>{
  const b=await fs.readFile(path.join(out,name+'.glb'));
  const scene=(await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'' )).scene;
  scene.traverse(o=>{if(o.isMesh){o.userData.sourceLink=name;o.geometry.computeBoundingBox();armMeshes.push(o);}});
  return scene;
}});
const panel=createPipePanel();
const cableChecks=[],portDirectionChecks=[],routingChecks=[],spoolChecks=[];
const ray=new T.Raycaster(),direction=new T.Vector3(.732,.411,.544).normalize();
const materialSides=new Map(armMeshes.map(o=>[o.material,o.material.side]));
for(const m of materialSides.keys())m.side=T.DoubleSide;
for(const pose of [HOME_POSE,[20,-50,-72,20,-80,35],[-20,-72,-48,-20,-105,-35]]){
  const accepted=model.setPose(pose);
  if(!accepted.ok)throw new Error(`Validation pose rejected: ${accepted.reason}`);
  model.root.updateMatrixWorld(true);
  for(const [name,t,target,point] of [
    ['red-supply-hose',0,model.accessories.feeder,[-.1975,0,.041]],
    ['red-supply-hose',1,model.root,[-.06,.20,1.014]],
    ['wire-feed-guide',0,model.accessories.spool,[0,0,.159]],
    ['wire-feed-guide',1,model.accessories.feeder,[.178,0,.041]],
    ['corrugated-main-hose',0,model.accessories.feeder,[-.065,.205,.048]],
    ['corrugated-main-hose',1,model.accessories.basePort,[-.059,0,0]]
  ]){
    const cable=model.root.getObjectByName(name);
    const actual=cable.localToWorld(cable.geometry.parameters.path.getPoint(t));
    const expected=target.localToWorld(new T.Vector3(...point));
    const error=actual.distanceTo(expected);
    if(error>1e-6)throw new Error(`${name}: detached from mounting point`);
    cableChecks.push({pose,name,end:t,attachmentErrorMetres:error});
  }
  for(const [name,end,target,axis] of [
    ['red-supply-hose',0,model.accessories.feeder,[-1,0,0]],
    ['red-supply-hose',1,model.root,[0,0,-1]],
    ['corrugated-main-hose',0,model.accessories.feeder,[0,1,0]],
    ['corrugated-main-hose',1,model.accessories.basePort,[1,0,0]]
  ]){
    const cable=model.root.getObjectByName(name);
    const tangent=cable.geometry.parameters.path.getTangent(end).transformDirection(cable.matrixWorld);
    const alignment=tangent.dot(new T.Vector3(...axis).transformDirection(target.matrixWorld));
    if(alignment<.999)throw new Error(`${name}: enters connector from the side`);
    portDirectionChecks.push({pose,name,end,alignment});
  }
  // Regression for the observed guide/shoulder intersections. This samples
  // cable centre-lines against manufacturer meshes, not full swept volumes.
  for(const name of ['corrugated-main-hose','red-supply-hose','wire-feed-guide']){
    const cable=model.root.getObjectByName(name);let samples=0;
    for(let i=4;i<=76;i++){
      const point=cable.localToWorld(cable.geometry.parameters.path.getPoint(i/80));
      for(const body of armMeshes){
        if(!body.geometry.boundingBox.containsPoint(body.worldToLocal(point.clone())))continue;
        ray.set(point,direction);
        const hits=ray.intersectObject(body,false).filter((h,j,a)=>j===0||h.distance-a[j-1].distance>1e-5);
        if(hits.length%2){
          ray.set(point,direction.clone().negate());
          const reverse=ray.intersectObject(body,false).filter((h,j,a)=>j===0||h.distance-a[j-1].distance>1e-5);
          if(reverse.length%2)throw new Error(`${name}: centre-line inside ${body.userData.sourceLink}, pose ${pose}, t=${i/80}`);
        }
      }
      samples++;
    }
    const points=cable.geometry.parameters.path.getSpacedPoints(200);let minBend=Infinity;
    for(let i=2;i<199;i++){
      const a=points[i].clone().sub(points[i-1]),b=points[i+1].clone().sub(points[i]);
      const cross=a.clone().cross(b).length();
      if(cross>1e-12)minBend=Math.min(minBend,a.length()*b.length()*points[i+1].distanceTo(points[i-1])/(2*cross));
    }
    // Geometric anti-kink check; not a vendor-specified cable bend limit.
    if(minBend<cable.geometry.parameters.radius*3)throw new Error(`${name}: sharp fold in cable geometry`);
    routingChecks.push({pose,name,centreLineSamples:samples,insideArmSamples:0,minimumBendRadiusMetres:minBend});
  }
  const main=model.root.getObjectByName('corrugated-main-hose');let spoolGap=Infinity;
  for(const point of main.geometry.parameters.path.getSpacedPoints(200)){
    const q=model.accessories.spool.worldToLocal(main.localToWorld(point));
    const gap=Math.hypot(Math.max(0,Math.hypot(q.x,q.z)-.195),Math.max(0,Math.abs(q.y)-.09))-.028;
    spoolGap=Math.min(spoolGap,gap);
  }
  // Conservative cylindrical reel envelope versus the full corrugated hose radius.
  if(spoolGap<.01)throw new Error('Main hose overlaps the reel or has insufficient visual clearance');
  let shoulderMaxY=-Infinity;
  for(const body of armMeshes.filter(o=>o.userData.sourceLink==='j1')){
    const bb=body.geometry.boundingBox;
    for(const x of [bb.min.x,bb.max.x])for(const y of [bb.min.y,bb.max.y])for(const z of [bb.min.z,bb.max.z]){
      shoulderMaxY=Math.max(shoulderMaxY,model.joints[1].worldToLocal(body.localToWorld(new T.Vector3(x,y,z))).y);
    }
  }
  const shoulderGap=model.accessories.spool.position.y-.09-shoulderMaxY;
  if(shoulderGap<.02)throw new Error('Reel envelope overlaps shoulder casing');
  spoolChecks.push({pose,mainHoseToReelEnvelopeMetres:spoolGap,reelToShoulderAxialGapMetres:shoulderGap});
}
for(const [m,side] of materialSides)m.side=side;
model.setPose(HOME_POSE);model.root.updateMatrixWorld(true);
const seatBounds=new T.Box3().setFromObject(model.root.getObjectByName('padded-backrest'));
const coilBounds=new T.Box3().setFromObject(model.root.getObjectByName('continuous-coiled-service-hose'));
const clearanceChecks={backrestToEquipmentFrontMetres:.576-seatBounds.max.x,hoseCoilAboveDeckMetres:coilBounds.min.z-.791};
if(clearanceChecks.backrestToEquipmentFrontMetres<=.04||clearanceChecks.hoseCoilAboveDeckMetres<=0)throw new Error('Seat or service coil intersects cabinet/deck');
const geometrySet=new Set();
for(const obj of [model.root,panel])obj.traverse(o=>{
  if(o.geometry&&!geometrySet.has(o.geometry)){geometrySet.add(o.geometry);o.geometry.normalizeNormals();}
});
const checks=[];
async function save(object,name){
  // Keep the web viewer instanced, but deliver ordinary editable mesh nodes in GLB.
  const instanced=[];object.traverse(o=>{if(o.isInstancedMesh)instanced.push(o);});
  for(const batch of instanced){
    const replacement=new T.Group();replacement.name=batch.name;replacement.userData={...batch.userData};
    replacement.position.copy(batch.position);replacement.quaternion.copy(batch.quaternion);replacement.scale.copy(batch.scale);
    for(let i=0;i<batch.count;i++){
      const part=new T.Mesh(batch.geometry,batch.material),matrix=new T.Matrix4();batch.getMatrixAt(i,matrix);
      matrix.decompose(part.position,part.quaternion,part.scale);part.name=batch.name+'-'+i;
      replacement.add(part);
    }
    batch.parent.add(replacement);batch.parent.remove(batch);
  }
  const scene=new T.Scene(),up=new T.Group();
  up.name='Z-up-to-glTF-Y-up';up.rotation.x=-Math.PI/2;up.add(object);scene.add(up);scene.updateMatrixWorld(true);
  const buffer=await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true});
  await fs.writeFile(path.join(out,name),new Uint8Array(buffer));
  const loaded=await loader.parseAsync(buffer,'');let vertices=0,triangles=0,meshes=0;
  const jsonLength=new DataView(buffer).getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,jsonLength)));
  if(name==='xiaomeng-h.glb'&&!(json.images?.length>0))throw new Error('Leather grain texture was lost in export');
  if(name.startsWith('tube-panel')&&!(json.images?.length>=3))throw new Error('Steel PBR textures were lost in export');
  let instances=0;
  loaded.scene.traverse(o=>{if(o.isMesh){const count=o.isInstancedMesh?o.count:1;instances+=count;meshes++;vertices+=o.geometry.attributes.position.count*count;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)*count/3;}});
  const bounds=new T.Box3().setFromObject(loaded.scene),size=bounds.getSize(new T.Vector3()).toArray();
  if(!meshes||!size.every(x=>Number.isFinite(x)&&x>0))throw new Error('Invalid exported geometry');
  checks.push({name,bytes:buffer.byteLength,meshes,instances,vertices,triangles,embeddedTextures:json.images?.length||0,boundsYUpMetres:size});
}
await save(model.root.clone(true),'xiaomeng-h.glb');
const arm=model.arm.clone(true);arm.position.set(0,0,0);arm.rotation.z=0;
await save(arm,'fanuc-m10id-8l-welding.glb');await save(panel.clone(true),'tube-panel.glb');
setPanelWeldPreview(panel,true);await save(panel,'tube-panel-welded.glb');
const names=[];model.root.traverse(o=>{if(/^J[1-6]$/.test(o.name))names.push(o.name);});
if(new Set(names).size!==6)throw new Error('Six articulated joints are required');
await fs.writeFile(path.join(out,'validation.json'),JSON.stringify({revision:6,panelValidation:'pipe-panel-validation.json',joints:names,cableChecks,portDirectionChecks,routingChecks,spoolChecks,clearanceChecks,motionValidation:'motion-validation.json',routingCheckScope:'Static GLB checks; the full fixed-length movement and collider validation is recorded in motion-validation.json. Quasi-static geometric constraints, not material dynamics.',assets:checks},null,2));
console.log(JSON.stringify(checks,null,2));
