import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {loadWeldingModel} from '../scripts/welding-model-loader.mjs';
import {HOME_POSE} from '../frontend/welding-model.js';
import {fixedDressCurve,LENGTH_TOLERANCE} from '../frontend/cable-constraints.js';
import {sampleMotion,MOTION_DURATION} from '../frontend/welding-motion.js';

const pointError=(a,b)=>Math.max(...a.map((p,i)=>p.distanceTo(b[i])));
function snapshot(model){
  return model.cableState.map(c=>({name:c.name,length:c.length,error:c.error,points:c.curve.getPoints(96)}));
}
function sameCurves(a,b){
  assert.deepEqual(a.map(c=>c.name),b.map(c=>c.name));
  for(let i=0;i<a.length;i++){
    assert.ok(Math.abs(a[i].length-b[i].length)<1e-10);
    assert.ok(pointError(a[i].points,b[i].points)<1e-10);
    assert.ok(Math.abs(b[i].error)<LENGTH_TOLERANCE);
  }
}

test('allocation-free dress sampling matches the original Bernstein definition',()=>{
  const v=a=>new T.Vector3(...a);
  const fit=fixedDressCurve(v([.1,.2,.3]),v([0,1,0]),v([.7,-.2,.2]),v([1,0,0]),2.1,v([0,1,-.7]).normalize());
  assert.equal(fit.ok,true);
  for(let i=0;i<=4096;i++){
    const t=i/4096,u=1-t,weights=[u**5,5*u**4*t,10*u**3*t*t,10*u*u*t**3,5*u*t**4,t**5];
    const original=new T.Vector3();
    weights.forEach((weight,j)=>original.addScaledVector(fit.curve.points[j],weight));
    assert.ok(original.distanceTo(fit.curve.getPoint(t))<1e-14);
  }
});

test('shape cache includes installation transforms, excludes rigid placement and wrist-only motion',async()=>{
  const model=await loadWeldingModel({renderCables:false,cableShapeCacheSize:16});
  const initial=model.cableState;
  model.root.position.set(2,-1,0);model.root.rotation.z=.6;
  assert.equal(model.setPose(HOME_POSE).ok,true);
  assert.equal(model.cableState,initial,'rigid placement should reuse only the shape');
  const wrist=[...HOME_POSE];wrist[5]=1;
  const accepted=model.setPose(wrist);
  assert.equal(accepted.ok,true);assert.equal(accepted.substeps,2);
  assert.equal(model.cableState,initial,'J6 cannot change these cable anchors');
  model.accessories.basePort.position.x+=.002;
  assert.equal(model.setPose(wrist).ok,true);
  assert.notEqual(model.cableState,initial,'connector edits must invalidate the cached shape');
  const end=model.arm.localToWorld(model.cableState[0].curve.getPoint(1));
  const anchor=model.accessories.basePort.localToWorld(new T.Vector3(-.059,0,0));
  assert.ok(end.distanceTo(anchor)<1e-10);
  // A newly moved world obstacle must be checked even when the shape is cached.
  const obstacle=new T.Mesh(new T.BoxGeometry(.035,.035,.035));obstacle.name='cache-regression-obstacle';
  obstacle.position.copy(model.arm.localToWorld(model.cableState[0].curve.getPoint(.5)));
  obstacle.updateMatrixWorld(true);model.setObstacles([obstacle]);
  const rejected=model.setPose(wrist);
  assert.equal(rejected.ok,false);assert.match(rejected.reason,/cache-regression-obstacle/);
  assert.deepEqual(model.joints.map(j=>j.userData.angleDeg),wrist);
  model.setObstacles([]);assert.equal(model.setPose(wrist).ok,true);
});

test('bounded and uncached shapes, with or without display meshes, preserve every checked substep',async()=>{
  const cached=await loadWeldingModel({renderCables:false,cableShapeCacheSize:2});
  const displayed=await loadWeldingModel({renderCables:true,cableShapeCacheSize:0});
  assert.equal(cached.arm.getObjectByName('flexible-dress-pack').children.length,0);
  assert.ok(displayed.arm.getObjectByName('flexible-dress-pack').children.length>0);
  for(const frame of [0,12,18,24,36,48,54,60,72,60,54,48,36,24,18,12,0]){
    const q=sampleMotion(frame/72*MOTION_DURATION);
    const a=cached.setPose(q),b=displayed.setPose(q);
    assert.equal(a.ok,true,a.reason);assert.equal(b.ok,true,b.reason);
    assert.equal(a.substeps,b.substeps);assert.deepEqual(a.cables,b.cables);
    sameCurves(snapshot(cached),snapshot(displayed));
  }
  for(const q of [[150,-62,-62,0,-90,0],[0,120,-62,0,-90,0],[0,-62,210,0,-90,0]]){
    const before=cached.joints.map(j=>j.userData.angleDeg),a=cached.setPose(q),b=displayed.setPose(q);
    assert.equal(a.ok,false);assert.equal(b.ok,false);assert.equal(a.reason,b.reason);
    assert.deepEqual(cached.joints.map(j=>j.userData.angleDeg),before);
    assert.deepEqual(displayed.joints.map(j=>j.userData.angleDeg),before);
  }
});
