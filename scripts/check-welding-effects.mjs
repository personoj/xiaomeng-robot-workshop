import assert from 'node:assert/strict';
import * as T from 'three';
import { createWeldingEffects } from '../frontend/welding-effects.js';

const scene=new T.Scene();
const fx=createWeldingEffects({scene,seed:94});
const point=new T.Vector3(.3,-.02,.8),direction=new T.Vector3(-.8,-.4,.3).normalize();
fx.setViewport(1080,38);
for(let i=0;i<120;i++)fx.update({point,direction,arcOn:true,dt:1/60});
const on=fx.getStats();
assert(on.activeSparks>0&&on.activeSparks<=96,'bounded live spark pool');
assert(on.activeSmoke>0&&on.activeSmoke<=112,'bounded live smoke pool');
assert(on.smokeEmitted>=63&&on.smokeEmitted<=64,'emission uses elapsed seconds within one particle');
assert.equal(fx.root.getObjectByName('white-blue-arc').visible,true);
assert(fx.light.position.distanceTo(point.clone().addScaledVector(direction,.018))<1e-12);

// Moving the accepted world contact moves the light/arc, but does not teleport fume.
const smokeGeometry=fx.root.getObjectByName('blue-grey-fume').geometry;
const existing=smokeGeometry.attributes.position.array.slice();
const next=new T.Vector3(1.7,-.1,.9);
fx.update({point:next,direction,arcOn:true,dt:0});
assert.deepEqual(smokeGeometry.attributes.position.array,existing);
assert(fx.root.getObjectByName('white-blue-arc').position.distanceTo(next.clone().addScaledVector(direction,.007))<1e-12);

const emissions=fx.getStats();
fx.update({arcOn:false,dt:1/60});
assert.equal(fx.light.intensity,0,'point light extinguishes immediately');
assert.equal(fx.root.getObjectByName('white-blue-arc').visible,false);
assert(fx.getStats().activeSmoke>0,'fume survives stopping arc');
for(let i=0;i<180;i++)fx.update({arcOn:false,dt:1/60});
const off=fx.getStats();
assert.equal(off.sparksEmitted,emissions.sparksEmitted,'no sparks emitted after arc stops');
assert.equal(off.smokeEmitted,emissions.smokeEmitted,'no smoke emitted after arc stops');
assert.equal(off.activeSparks,0);assert.equal(off.activeSmoke,0);
fx.root.traverse(object=>{
  if(!object.geometry)return;
  for(const attribute of Object.values(object.geometry.attributes))
    assert([...attribute.array].every(Number.isFinite),'all geometry attributes remain finite');
});
assert.throws(()=>fx.update({point:[NaN,0,0],dt:0}),RangeError);
fx.update({point:[0,0,0],direction:[0,1,0],arcOn:true,dt:5});
assert(fx.getStats().activeSparks<=2,'resuming a hidden tab does not produce an emission burst');
fx.clear();assert.equal(fx.getStats().activeSmoke,0);
fx.dispose();fx.dispose();assert.equal(scene.children.length,0);
assert.throws(()=>fx.update({dt:1/60}),/disposed/);

function countAtFPS(fps){
  const effect=createWeldingEffects();
  for(let i=0;i<fps*2;i++)effect.update({point:[0,0,0],direction:[0,0,1],arcOn:true,dt:1/fps});
  const count=effect.getStats();effect.dispose();return count;
}
const fps30=countAtFPS(30),fps60=countAtFPS(60);
assert(Math.abs(fps30.sparksEmitted-fps60.sparksEmitted)<=1);
assert(Math.abs(fps30.smokeEmitted-fps60.smokeEmitted)<=1);
console.log(JSON.stringify({ok:true,on,off,frameRateComparison:{fps30,fps60},
  verified:['world-space anchors','stationary residual particles','arc-off lifecycle',
    'bounded pools','finite attributes','no background-tab bursts','dispose']},null,2));
