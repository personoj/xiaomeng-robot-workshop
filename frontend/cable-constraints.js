import * as T from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Nominal model lengths in metres, not measurements of the manufacturer's hose set.
export const CABLE_LENGTHS = Object.freeze({
  'corrugated-main-hose':2.10,'red-supply-hose':2.20,'wire-feed-guide':1.25,
});
export const LENGTH_TOLERANCE=.0002;
const va=new T.Vector3(),vb=new T.Vector3();
function length(curve,segments=384){
  curve.getPoint(0,va);let total=0;
  for(let i=1;i<=segments;i++){curve.getPoint(i/segments,vb);total+=va.distanceTo(vb);va.copy(vb);}
  return total;
}
function fit(build,target,lo,hi){
  let c=build(lo),lowLength=length(c);
  if(lowLength>target+LENGTH_TOLERANCE)return {ok:false,reason:'固定线长不足，不能继续拉伸'};
  c=build(hi);
  if(length(c)<target)return {ok:false,reason:'当前走线无法容纳固定余量'};
  for(let i=0;i<24;i++){
    const mid=(lo+hi)/2;c=build(mid);
    if(length(c)<target)lo=mid;else hi=mid;
  }
  c=build((lo+hi)/2);c.arcLengthDivisions=1024;
  const actual=length(c,2048);
  return {ok:Math.abs(actual-target)<=LENGTH_TOLERANCE,curve:c,length:actual,target,error:actual-target};
}
export function fixedBezier(a,departure,b,arrival,target,handles){
  return fit(scale=>new T.CubicBezierCurve3(a.clone(),a.clone().addScaledVector(departure,handles[0]*scale),b.clone().addScaledVector(arrival,-handles[1]*scale),b.clone()),target,.035,4);
}
class DressCurve extends T.Curve{
  constructor(points){super();this.points=points;}
  getPoint(t,target=new T.Vector3()){
    const u=1-t,weights=[u**5,5*u**4*t,10*u**3*t*t,10*u*u*t**3,5*u*t**4,t**5];
    target.set(0,0,0);for(let i=0;i<6;i++)target.addScaledVector(this.points[i],weights[i]);return target;
  }
}
export function fixedDressCurve(a,departure,b,arrival,target,outward,handle=.28){
  return fit(slack=>new DressCurve([a.clone(),a.clone().addScaledVector(departure,handle),
    a.clone().addScaledVector(departure,handle*2).addScaledVector(outward,slack),
    b.clone().addScaledVector(arrival,-handle*2).addScaledVector(outward,slack),
    b.clone().addScaledVector(arrival,-handle),b.clone()]),target,0,6);
}
export function fixedGuide(points,outward,target){
  // The take-off eye and terminal sleeve remain pinned; surplus wire bows outside the arm.
  return fit(slack=>new T.CatmullRomCurve3(points.map((p,i)=>p.clone().addScaledVector(outward,i===2?slack:i===3?slack*.7:0))),target,0,1.0);
}
export function curveMetrics(curve,radius){
  const points=curve.getSpacedPoints(96);let bend=Infinity;
  for(let i=1;i<points.length-1;i++){
    const a=points[i].clone().sub(points[i-1]),b=points[i+1].clone().sub(points[i]);
    const cross=a.clone().cross(b).length();
    if(cross>1e-12)bend=Math.min(bend,a.length()*b.length()*points[i-1].distanceTo(points[i+1])/(2*cross));
  }
  return {points,bend,requiredBend:radius*3};
}

function makeCollider(mesh,name=mesh.name){
  mesh.geometry.computeBoundingBox();
  const bvh=mesh.geometry.boundsTree||new MeshBVH(mesh.geometry,{indirect:true,targetLeafSize:8});
  mesh.geometry.boundsTree=bvh;
  return {object:mesh,geometry:mesh.geometry,bvh,name,inverse:new T.Matrix4()};
}
function mergeForGroup(objects,frame){
  frame.updateWorldMatrix(true,true);const inv=frame.matrixWorld.clone().invert(),parts=[];
  for(const o of objects){
    let g=o.geometry.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inv,o.matrixWorld));
    if(g.index){const indexed=g;g=g.toNonIndexed();indexed.dispose();}
    for(const name of Object.keys(g.attributes))if(name!=='position')g.deleteAttribute(name);
    g.clearGroups();parts.push(g);
  }
  const merged=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());return merged;
}
const rotorNames=new Set(['copper-wire-pack','stainless-spool-rim','black-spool-web']);
const staticNames=new Set(['rear-lower-cabinet','equipment-chassis-core','equipment-top-cover','continuous-back-shell','formed-steel-cylinder','grey-structural-spine','auxiliary-power-box','junction-lid','front-lift-platform','steering-column-shaft','moulded-seat-pan']);
const d1=new T.Vector3(),d2=new T.Vector3(),dr=new T.Vector3();
function segmentDistance(a,b,c,d){
  d1.subVectors(b,a);d2.subVectors(d,c);dr.subVectors(a,c);
  const aa=d1.lengthSq(),ee=d2.lengthSq(),bb=d1.dot(d2),cc=d1.dot(dr),ff=d2.dot(dr),den=aa*ee-bb*bb;
  let s=den>1e-16?T.MathUtils.clamp((bb*ff-cc*ee)/den,0,1):0,t=(bb*s+ff)/ee;
  if(t<0){t=0;s=T.MathUtils.clamp(-cc/aa,0,1);}else if(t>1){t=1;s=T.MathUtils.clamp((bb-cc)/aa,0,1);}
  return dr.addScaledVector(d1,s).addScaledVector(d2,-t).length();
}
function nearSegments(a,b,c,d,r){
  for(const axis of ['x','y','z'])if(Math.min(a[axis],b[axis])>Math.max(c[axis],d[axis])+r||Math.min(c[axis],d[axis])>Math.max(a[axis],b[axis])+r)return false;
  return segmentDistance(a,b,c,d)<r;
}
export function createCableCollisionModel({root,arm,links,spool,feeder,torch}){
  const colliders=[];
  links.forEach((link,i)=>link.traverse(o=>{if(o.isMesh)colliders.push({...makeCollider(o,`机械臂 J${i}`),linkIndex:i});}));
  const armColliders=[...colliders];
  const rotorParts=[];spool.traverse(o=>{if(o.isMesh&&rotorNames.has(o.name))rotorParts.push(o);});
  const rotorMesh=new T.Mesh(mergeForGroup(rotorParts,spool));rotorMesh.name='线盘转动部分';
  const rotor=makeCollider(rotorMesh);rotor.object=spool;colliders.push(rotor);
  const staticParts=[];root.traverse(o=>{if(o.isMesh&&staticNames.has(o.name))staticParts.push(o);});
  const staticMesh=new T.Mesh(mergeForGroup(staticParts,arm));staticMesh.name='底盘、机箱与气瓶';
  const chassis=makeCollider(staticMesh);chassis.object=arm;colliders.push(chassis);
  const feederParts=[];feeder.traverse(o=>{if(o.isMesh&&['machined-feeder-body','feed-motor-can'].includes(o.name))feederParts.push(o);});
  const feedMesh=new T.Mesh(mergeForGroup(feederParts,feeder));feedMesh.name='送丝机构';
  const feed=makeCollider(feedMesh);feed.object=feeder;colliders.push(feed);
  const torchParts=[];torch.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&o.name!=='projecting-weld-wire')torchParts.push(o);});
  const torchCollider=makeCollider(new T.Mesh(mergeForGroup(torchParts,torch)),'焊枪');torchCollider.object=torch;
  let obstacles=[];
  function setObstacles(objects){obstacles=objects.map(o=>makeCollider(o,o.name||'场景障碍'));}
  const line=new T.Line3(),box=new T.Box3(),transform=new T.Matrix4(),nearA=new T.Vector3(),nearB=new T.Vector3();
  function capsule(collider,a,b,r){
    line.set(a,b);box.makeEmpty().expandByPoint(a).expandByPoint(b).expandByScalar(r);
    if(!collider.geometry.boundingBox.intersectsBox(box))return false;
    return collider.bvh.shapecast({intersectsBounds:bb=>bb.intersectsBox(box),intersectsTriangle:tri=>tri.closestPointToSegment(line,nearA,nearB)<r});
  }
  function validate(cables){
    root.updateMatrixWorld(true);for(const c of colliders)c.inverse.copy(c.object.matrixWorld).invert();
    for(const c of obstacles){c.object.updateWorldMatrix(true,false);c.inverse.copy(c.object.matrixWorld).invert();}
    const diagnostics=[];
    for(const cable of cables){
      const {points,bend,requiredBend}=curveMetrics(cable.curve,cable.radius);
      cable.samples=points;
      if(bend<requiredBend)return {ok:false,reason:`${cable.label}弯曲过急`,cable:cable.name};
      for(const collider of [...colliders,...obstacles]){
        transform.multiplyMatrices(collider.inverse,arm.matrixWorld);
        for(let i=0;i<points.length-1;i++){
          // Only connector sleeves / the wire take-off contact are exempt, not a whole link.
          const s0=i/(points.length-1)*cable.target,s1=(i+1)/(points.length-1)*cable.target;
          const sleeve=cable.radius+.012;
          if((collider===feed&&s0<sleeve)||(colliders.includes(collider)&&collider!==rotor&&s1>cable.target-sleeve))continue;
          if(cable.name==='wire-feed-guide'&&collider===feed&&s1>cable.target-.015)continue;
          if(collider===rotor&&cable.name==='wire-feed-guide'&&s0<.13)continue;
          const a=points[i].clone().applyMatrix4(transform),b=points[i+1].clone().applyMatrix4(transform);
          if(capsule(collider,a,b,cable.radius+.0015))return {ok:false,reason:`${cable.label}接近${collider.name}`,cable:cable.name,segment:i};
        }
      }
      diagnostics.push({name:cable.name,label:cable.label,length:cable.length,target:cable.target,error:cable.error,bend});
    }
    for(let u=0;u<cables.length;u++)for(let v=u;v<cables.length;v++){
      const a=cables[u],b=cables[v],r=a.radius+b.radius+.0005;
      for(let i=0;i<a.samples.length-1;i++)for(let j=u===v?i+2:0;j<b.samples.length-1;j++){
        if(u===v&&(j-i)*a.target/96<4*a.radius+.02)continue;
        if(nearSegments(a.samples[i],a.samples[i+1],b.samples[j],b.samples[j+1],r))return {ok:false,reason:u===v?`${a.label}自相交`:`${a.label}与${b.label}相交`};
      }
    }
    // The complete rotor mesh must also clear each factory arm mesh, at every pose.
    for(const collider of colliders.filter(c=>c!==rotor)){
      transform.multiplyMatrices(collider.inverse,spool.matrixWorld);
      const rotorBox=rotor.geometry.boundingBox.clone().applyMatrix4(transform);
      if(collider.geometry.boundingBox.intersectsBox(rotorBox)&&collider.bvh.intersectsGeometry(rotor.geometry,transform))return {ok:false,reason:`线盘与${collider.name}碰撞`};
    }
    for(const link of armColliders.filter(c=>c.linkIndex>0)){
      transform.multiplyMatrices(chassis.inverse,link.object.matrixWorld);
      if(chassis.geometry.boundingBox.intersectsBox(link.geometry.boundingBox.clone().applyMatrix4(transform))&&chassis.bvh.intersectsGeometry(link.geometry,transform))return {ok:false,reason:'机械臂与机箱或底盘碰撞'};
    }
    for(let i=0;i<armColliders.length;i++)for(let j=i+1;j<armColliders.length;j++){
      const a=armColliders[i],b=armColliders[j];if(Math.abs(a.linkIndex-b.linkIndex)<=1)continue;
      transform.multiplyMatrices(a.inverse,b.object.matrixWorld);
      if(a.geometry.boundingBox.intersectsBox(b.geometry.boundingBox.clone().applyMatrix4(transform))&&a.bvh.intersectsGeometry(b.geometry,transform))return {ok:false,reason:'机械臂非相邻连杆相交'};
    }
    for(const collider of [...armColliders.filter(c=>c.linkIndex<5),chassis,rotor,feed]){
      transform.multiplyMatrices(collider.inverse,torch.matrixWorld);
      if(collider.geometry.boundingBox.intersectsBox(torchCollider.geometry.boundingBox.clone().applyMatrix4(transform))&&collider.bvh.intersectsGeometry(torchCollider.geometry,transform))return {ok:false,reason:`焊枪与${collider.name}碰撞`};
    }
    for(const obstacle of obstacles)for(const part of [...colliders,torchCollider]){
      transform.multiplyMatrices(obstacle.inverse,part.object.matrixWorld);
      if(obstacle.geometry.boundingBox.intersectsBox(part.geometry.boundingBox.clone().applyMatrix4(transform))&&obstacle.bvh.intersectsGeometry(part.geometry,transform))return {ok:false,reason:`${part.name}与${obstacle.name}碰撞`};
    }
    return {ok:true,cables:diagnostics};
  }
  return {validate,setObstacles};
}

// Update an existing tube in place. Arc-length positions keep rib pitch constant.
export function updateTube(mesh,curve){
  const geometry=mesh.geometry,{tubularSegments:n,radialSegments:m,radius}=geometry.parameters;
  const frames=curve.computeFrenetFrames(n,false),pos=geometry.attributes.position,norm=geometry.attributes.normal;
  const p=new T.Vector3(),normal=new T.Vector3();let k=0;
  for(let i=0;i<=n;i++){
    curve.getPointAt(i/n,p);
    for(let j=0;j<=m;j++){
      const a=j/m*Math.PI*2;
      normal.copy(frames.normals[i]).multiplyScalar(-Math.cos(a)).addScaledVector(frames.binormals[i],Math.sin(a));
      norm.setXYZ(k,normal.x,normal.y,normal.z);pos.setXYZ(k++,p.x+radius*normal.x,p.y+radius*normal.y,p.z+radius*normal.z);
    }
  }
  geometry.parameters.path=curve;pos.needsUpdate=norm.needsUpdate=true;geometry.computeBoundingSphere();geometry.computeBoundingBox();
}
