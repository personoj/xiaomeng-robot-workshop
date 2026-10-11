import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import { createPipePanel, setPanelWeldPreview, appendPanelWeldContact, clearPanelWeldTrace } from '../frontend/tube-panel-model.js';

const panel=createPipePanel(),pipes=panel.getObjectByName('parallel-hollow-tubes').children,seams=panel.getObjectByName('weld-seams').children;
const {diameter,wall,length,pitch}=panel.userData,radius=diameter/2,ray=new T.Raycaster();
assert.equal(pipes.length,8);assert.equal(seams.length,7);
assert.ok(pitch-diameter<.001,'The tubes should be almost touching');
assert.ok(seams.every(s=>s.children.every(d=>!d.visible)),'Initial state must be unwelded');
for(const pipe of pipes){
  ray.set(new T.Vector3(-length/2-.01,pipe.position.y,0),new T.Vector3(1,0,0));
  assert.equal(ray.intersectObject(pipe).length,0,'Tube bore must be open all the way through');
  ray.set(new T.Vector3(0,pipe.position.y,.1),new T.Vector3(0,0,-1));
  const outside=ray.intersectObject(pipe)[0].point.z;
  ray.set(new T.Vector3(0,pipe.position.y,0),new T.Vector3(0,0,1));
  const inside=ray.intersectObject(pipe)[0].point.z;
  assert.ok(Math.abs(outside-inside-wall)<1e-6,'Actual tube wall thickness');
}
setPanelWeldPreview(panel,true);panel.updateMatrixWorld(true);
let fusionChecks=0,minOverlap=Infinity,maxOverlap=0;
for(let i=0;i<seams.length;i++)for(const deposit of seams[i].children){
  const bridge=deposit.children[0],side=bridge.material.side;bridge.material.side=T.DoubleSide;
  for(const sign of [-1,1]){
    const origin=new T.Vector3(deposit.position.x,seams[i].position.y,.010),dir=new T.Vector3(0,sign,0);
    ray.set(origin,dir);const weld=ray.intersectObject(bridge)[0];
    ray.set(origin,dir);const pipe=ray.intersectObject(pipes[i+(sign===1?1:0)])[0];
    assert.ok(weld&&pipe,'Both weld and tube walls must exist at the contact section');
    const overlap=weld.distance-pipe.distance;
    assert.ok(overlap>0&&overlap<.0003,'Each short bead must reach BOTH actual tube walls');
    minOverlap=Math.min(minOverlap,overlap);maxOverlap=Math.max(maxOverlap,overlap);fusionChecks++;
  }
  bridge.material.side=side;
}
const seam=seams[2],z=seam.userData.start[2];
const sample=(x,arcOn=true,other={})=>appendPanelWeldContact(panel,{seamId:seam.name,position:[x,seam.position.y,z],arcOn,...other});
let report=sample(-.7);assert.equal(report.depositedLength,0);
report=sample(-.69);assert.ok(Math.abs(report.depositedLength-.010)<1e-9);
let first=panel.getObjectByName('trajectory-weld-deposits').children[0];
const usedVertices=first.geometry.attributes.position.array.slice(0,18*32*3);
report=sample(-.68);assert.ok(Math.abs(report.depositedLength-.020)<1e-9);
assert.deepEqual(first.geometry.attributes.position.array.slice(0,usedVertices.length),usedVertices,'Deposited geometry stays fixed as the tip advances');
panel.updateMatrixWorld(true);
const materialSide=first.material.side;first.material.side=T.DoubleSide;
for(const sign of [-1,1]){
  ray.set(new T.Vector3(-.689,seam.position.y,.010),new T.Vector3(0,sign,0));
  const weld=ray.intersectObject(first)[0];
  const tube=ray.intersectObject(pipes[2+(sign===1?1:0)])[0];
  assert.ok(weld&&tube&&weld.distance>tube.distance,'Live extrusion must also join both tube walls');
}
first.material.side=materialSide;
assert.equal(sample(-.68).depositedLength,report.depositedLength,'A stationary tip adds no length');
sample(-.68,false);sample(-.50);report=sample(-.49);
assert.ok(Math.abs(report.depositedLength-.030)<1e-9);assert.equal(report.strokes,2,'Restarting the arc leaves the travel gap unfilled');
const beforeJump=report.depositedLength;
report=sample(.5);assert.equal(report.depositedLength,beforeJump,'A discontinuous/teleported sample cannot paint the intervening route');
sample(.51);assert.equal(panel.getObjectByName('trajectory-weld-deposits').children.length,3);
report=sample(.52,true,{position:[.52,seam.position.y,z+.06]});assert.equal(report.reason,'outside-seam-contact');
assert.equal(report.active,false,'Lifting the torch must break deposition');
clearPanelWeldTrace(panel);assert.equal(panel.getObjectByName('trajectory-weld-deposits'),undefined);
assert.ok(seams.every(s=>s.children.every(d=>!d.visible)),'Reset returns to clean unwelded steel');
// Reverse travel and buffer growth preserve already deposited world positions too.
sample(.2);sample(.19);
first=panel.getObjectByName('trajectory-weld-deposits').children[0];
const reverseVertices=first.geometry.attributes.position.array.slice(0,18*32*3);
for(let i=2;i<=8;i++)sample(.2-i*.01);
assert.deepEqual(first.geometry.attributes.position.array.slice(0,reverseVertices.length),reverseVertices);
assert.ok(Math.abs(first.userData.depositedLength-.08)<1e-9);
clearPanelWeldTrace(panel);
const summary={tubes:pipes.length,openBores:8,wallMetres:wall,gapMetres:pitch-diameter,seams:seams.length,previewBeads:seams.reduce((n,s)=>n+s.children.length,0),fusionChecks,minOverlapMetres:minOverlap,maxOverlapMetres:maxOverlap,measuredContactDeposition:'Passed: grows from contact travel, fixed deposited vertices, stationary/off/lift/discontinuous travel do not paint gaps',scope:'Appearance geometry for straight pipe seams. No live robot controller is connected.'};
await fs.writeFile(new URL('../frontend/public/models/xiaomeng-h/pipe-panel-validation.json',import.meta.url),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
