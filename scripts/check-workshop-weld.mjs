import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createPipePanel,appendPanelWeldContact} from '../frontend/tube-panel-model.js';
import {weldFK} from '../frontend/welding-kinematics.js';
const proof=JSON.parse(await fs.readFile('.local/weld-complete-proof.json','utf8'));
const plan=JSON.parse(await fs.readFile(`.local/weld-plans/${proof.job.id}.json`,'utf8'));
const input=JSON.parse(await fs.readFile(`.local/weld-plans/${proof.job.id}.input.json`,'utf8'));
const panel=createPipePanel(),arc=plan.frames.filter(f=>f.arc_on),start=performance.now();
let result,maxError=0,first;
for(let i=0;i<arc.length;i++){
  const frame=arc[i],fk=weldFK(frame.pose),transform=new T.Matrix4().makeRotationZ(frame.heading);transform.setPosition(...frame.position);
  const actual=fk.point.applyMatrix4(transform),[x,y,z]=input.panel.position;
  const local=[actual.x-x,actual.z-z,y-actual.y];
  maxError=Math.max(maxError,new T.Vector3(...local).distanceTo(new T.Vector3(...frame.contact)));
  assert.ok(maxError<1e-6,'Saved weld contact must come from actual accepted FK');
  result=appendPanelWeldContact(panel,{seamId:plan.seam_id,position:local,arcOn:true,deferGeometry:i<arc.length-1});
  const mesh=panel.getObjectByName('trajectory-weld-deposits').children[0];
  if(mesh&&!first)first=Array.from(mesh.geometry.attributes.position.array.slice(0,96));
}
const mesh=panel.getObjectByName('trajectory-weld-deposits').children[0];
assert.deepEqual(Array.from(mesh.geometry.attributes.position.array.slice(0,96)),first,'Already deposited metal must not be stretched');
assert.ok(result.depositedLength>2.34);
assert.ok(Array.from(mesh.geometry.attributes.normal.array).every(Number.isFinite));
const length=result.depositedLength;
for(let i=0;i<50;i++)assert.equal(appendPanelWeldContact(panel,{seamId:plan.seam_id,position:arc.at(-1).contact,arcOn:true}).depositedLength,length);
assert.equal(appendPanelWeldContact(panel,{arcOn:false}).depositedLength,length);
console.log(JSON.stringify({ok:true,samples:arc.length,depositedMetres:length,actualFKErrorMetres:maxError,restoreMs:performance.now()-start,stationaryAndArcOff:'no growth'},null,2));
