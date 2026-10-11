import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as T from 'three';
import {loadWeldingModel} from './welding-model-loader.mjs';
import {rollWheels} from '../frontend/workshop-layout.js';
import {createPipePanel,appendPanelWeldContact} from '../frontend/tube-panel-model.js';

const model=await loadWeldingModel(),rotors=[],fixed=[];
model.root.traverse(o=>{if(o.name==='road-wheel-rotor')rotors.push(o);if(['yellow-mudguard','fender-bracket'].includes(o.name))fixed.push(o);});
assert.equal(rotors.length,4);assert.equal(fixed.filter(o=>o.name==='yellow-mudguard').length,4);
const before=fixed.map(o=>{o.updateMatrix();return o.matrix.toArray();});
rollWheels(model.root,[0,0,0],[.254,0,0],0);rotors.forEach(o=>assert.ok(Math.abs(o.rotation.y-1)<1e-10));
fixed.forEach((o,i)=>{o.updateMatrix();assert.deepEqual(o.matrix.toArray(),before[i]);});
rollWheels(model.root,[.254,0,0],[0,0,0],0);rotors.forEach(o=>assert.ok(Math.abs(o.rotation.y)<1e-10));
rollWheels(model.root,[0,0,0],[0,.254,0],Math.PI/2);rotors.forEach(o=>assert.ok(Math.abs(o.rotation.y-1)<1e-10));
const reports=[];
for(const path of process.argv.slice(2)){
  const plan=JSON.parse(await fs.readFile(path,'utf8')),panel=createPipePanel();let lastX=Infinity,strokes=0,active=false,length=0;
  for(const f of plan.frames){
    if(f.phase!=='positioning'){assert.deepEqual(f.position,plan.parking.position);assert.equal(f.heading,plan.parking.heading);}
    if(f.arc_on){
      if(!active)strokes++;
      assert.ok(f.contact[0]<=lastX+.0002,'Welding direction must stay right to left');lastX=f.contact[0];
      length=appendPanelWeldContact(panel,{seamId:plan.seam_id,position:f.contact,arcOn:true,deferGeometry:true}).depositedLength;
    }else appendPanelWeldContact(panel,{arcOn:false});
    active=f.arc_on;
  }
  assert.equal(strokes,14);assert.ok(length>.44&&length<.46);
  const meshes=panel.getObjectByName('trajectory-weld-deposits').children;assert.equal(meshes.length,14);
  assert.ok(meshes[0].userData.startX>1.15&&meshes.at(-1).userData.endX< -1.15);
  for(let i=1;i<meshes.length;i++)assert.ok(meshes[i-1].userData.endX-meshes[i].userData.startX>.14,'No metal between stitches');
  reports.push({path,frames:plan.frames.length,stitches:strokes,depositedMetres:length,baseLocked:true});
}
console.log(JSON.stringify({wheelDirections:'forward/reverse/rotated heading passed',fendersFixed:true,plans:reports},null,2));
