import * as T from 'three';

// Metres, Z up, tubes run along X. Dimensions are illustrative, not photo measurements.
export const PANEL_DEFAULTS = Object.freeze({count:8,length:2.4,diameter:.076,wall:.004,pitch:.0768});
const clamp=T.MathUtils.clamp, tau=Math.PI*2;
const hash=(x,y,seed=0)=>{let n=Math.imul(x+seed*101,374761393)+Math.imul(y,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;};
function noise(x,y,period,seed){
  const a=Math.floor(x),b=Math.floor(y),u=x-a,v=y-b,s=u*u*(3-2*u),t=v*v*(3-2*v);
  const h=(i,j)=>hash((i%period+period)%period,(j%period+period)%period,seed);
  return T.MathUtils.lerp(T.MathUtils.lerp(h(a,b),h(a+1,b),s),T.MathUtils.lerp(h(a,b+1),h(a+1,b+1),s),t);
}
let surfaceMaps;
function steelMaps(){
  if(surfaceMaps)return surfaceMaps;
  const n=512,albedo=new Uint8Array(n*n*4),mr=new Uint8Array(n*n*4),normal=new Uint8Array(n*n*4),height=new Float32Array(n*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const p=(y*n+x)*4,u=x/n,v=y/n;
    const broad=noise(u*12,v*12,12,3),scale=noise(u*45,v*45,45,6),grain=hash(x,y,21);
    const oxide=clamp((noise(u*9,v*9,9,8)-.64)*1.2,0,.13);
    const tone=88+14*(broad-.5)+12*(scale-.5)+22*(grain-.5);
    albedo[p]=tone+oxide*31;albedo[p+1]=tone+3-oxide*10;albedo[p+2]=tone+5-oxide*25;albedo[p+3]=255;
    mr[p]=255;mr[p+1]=clamp(183+34*scale+20*oxide,0,255);mr[p+2]=clamp(190-oxide*150,0,255);mr[p+3]=255;
    height[y*n+x]=.50*grain+.32*scale+.18*broad;
  }
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const p=(y*n+x)*4,dx=height[y*n+(x+1)%n]-height[y*n+(x+n-1)%n],dy=height[((y+1)%n)*n+x]-height[((y+n-1)%n)*n+x];
    const v=new T.Vector3(-dx*.36,-dy*.36,1).normalize();
    normal[p]=(v.x*.5+.5)*255;normal[p+1]=(v.y*.5+.5)*255;normal[p+2]=(v.z*.5+.5)*255;normal[p+3]=255;
  }
  const tex=(data,name,srgb=false)=>{
    const t=new T.DataTexture(data,n,n,T.RGBAFormat);t.name=name;t.wrapS=t.wrapT=T.RepeatWrapping;
    t.magFilter=T.LinearFilter;t.minFilter=T.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=8;
    if(srgb)t.colorSpace=T.SRGBColorSpace;t.needsUpdate=true;return t;
  };
  surfaceMaps={map:tex(albedo,'steel-mill-scale-albedo',true),roughnessMap:tex(mr,'steel-metal-rough'),normalMap:tex(normal,'steel-micro-pitting')};
  // One shared G/B image avoids any nonstandard shader or exporter texture merging.
  surfaceMaps.metalnessMap=surfaceMaps.roughnessMap;
  return surfaceMaps;
}
function steelMaterial(name,color='#ffffff',opts={}){
  const m=new T.MeshStandardMaterial({...steelMaps(),color,metalness:1,roughness:1,normalScale:new T.Vector2(.65,.65),...opts});m.name=name;return m;
}
function addMesh(parent,name,geometry,material){
  const o=new T.Mesh(geometry,material);o.name=name;o.castShadow=o.receiveShadow=true;parent.add(o);return o;
}
function box(parent,name,size,pos,material){
  const g=new T.BoxGeometry(...size),uv=g.attributes.uv;
  // Give the stock sections a physical texture scale instead of stretching a square.
  for(let i=0;i<uv.count;i++){const face=Math.floor(i/4);uv.setXY(i,uv.getX(i)*(face<2?size[2]:size[0])/.30,uv.getY(i)*(face<4?size[1]:size[2])/.30);}
  const o=addMesh(parent,name,g,material);o.position.set(...pos);return o;
}

function pipeGeometry(length,outer,inner,offset){
  const p=[],uv=[],indices=[],groups=[],segments=96,bevel=.00065;
  // Four continuous surfaces: outer barrel, bore, and two annular cut ends.
  const surface=(rings,sample,mat,reverse=false)=>{
    const base=p.length/3,start=indices.length;
    for(let i=0;i<=rings;i++)for(let j=0;j<=segments;j++){
      const a=j/segments*tau,[x,r]=sample(i/rings,a);p.push(x,r*Math.cos(a),r*Math.sin(a));
      uv.push(x/.32+offset,j/segments*tau*outer/.32+offset*.37);
    }
    for(let i=0;i<rings;i++)for(let j=0;j<segments;j++){
      const a=base+i*(segments+1)+j,b=a+segments+1,c=b+1,d=a+1;
      indices.push(...(reverse?[a,b,d,b,c,d]:[a,d,b,b,d,c]));
    }
    groups.push([start,indices.length-start,mat]);
  };
  surface(48,t=>[-length/2+bevel+t*(length-2*bevel),outer],0);
  surface(32,t=>[-length/2+t*length,inner],1,true);
  // The cut lip keeps a full wall and a narrow external bevel, never a solid cap.
  for(const side of [-1,1])surface(2,(t,a)=>{
    const r=inner+(outer-inner)*t;
    const edge=t===1?bevel:0;
    return [side*(length/2-edge),r];
  },2,side===1);
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);
  for(const args of groups)g.addGroup(...args);g.computeVertexNormals();g.computeBoundingBox();return g;
}

// One solid weld deposit spanning both tube walls, not two lines on a backing bar.
// The sides follow the actual round walls, with 0.15 mm overlap at the fusion toes.
function beadGeometry(length,radius,pitch,seed){
  const p=[],uv=[],idx=[],nx=Math.ceil(length/.0006),topSegments=14,sideSegments=8;
  const rootZ=.0012,toeZ=radius*.40,penetration=.00015,ringSize=topSegments+1+2*sideSegments+1;
  for(let i=0;i<=nx;i++){
    const t=i/nx,x=(t-.5)*length,fade=Math.pow(Math.max(0,Math.sin(Math.PI*t)),.25);
    const toe=rootZ+.0003+(toeZ-rootZ-.0003)*fade;
    const halfWidth=z=>pitch/2-Math.sqrt(radius*radius-z*z)+penetration;
    const ring=[];
    // Clockwise in Y/Z: left toe -> convex crown -> right toe -> fused root.
    for(let j=0;j<=topSegments;j++){
      const s=j/topSegments*2-1;
      const ripple=1+.10*Math.sin(x/.0019*tau+s*s*2.8+seed)+.035*Math.sin(x/.0037*tau+seed);
      ring.push([s*halfWidth(toe),toe+.0026*(1-s*s)*fade*ripple]);
    }
    for(let j=1;j<=sideSegments;j++){const z=T.MathUtils.lerp(toe,rootZ,j/sideSegments);ring.push([halfWidth(z),z]);}
    ring.push([-halfWidth(rootZ),rootZ]);
    for(let j=1;j<=sideSegments;j++){const z=T.MathUtils.lerp(rootZ,toe,j/sideSegments);ring.push([-halfWidth(z),z]);}
    for(let j=0;j<ringSize;j++){p.push(x,...ring[j]);uv.push(t*length/.018,j/ringSize);}
  }
  for(let i=0;i<nx;i++)for(let j=0;j<ringSize-1;j++){
    const a=i*ringSize+j,b=a+ringSize;idx.push(a,b,a+1,b,b+1,a+1);
  }
  // End caps lie inside the tapered start/stop of the deposited bead.
  for(const end of [0,nx])for(let j=1;j<ringSize-2;j++){
    const a=end*ringSize;idx.push(...(end===0?[a,a+j,a+j+1]:[a,a+j+1,a+j]));
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}

export function createPipePanel(options={}){
  const {count,length,diameter,wall,pitch}={...PANEL_DEFAULTS,...options};
  if(!Number.isInteger(count)||count<2||count>24||![length,diameter,wall,pitch].every(Number.isFinite)||wall<=0||diameter<=2*wall||pitch<=diameter||length<diameter*4)throw new Error('Invalid tube-panel dimensions');
  const root=new T.Group();root.name='tube-panel-longitudinal-seams';
  const radius=diameter/2,runLength=length-.05;
  root.userData={units:'metres',count,length,diameter,wall,pitch,clearance:pitch-diameter,
    fidelity:'Photo-guided appearance; nominal demonstration dimensions, not a measured CAD model',
    state:'unwelded',seamCount:count-1,axis:'X',weldPattern:'intermittent-pipe-to-pipe-bridges',revision:3};
  const pipes=new T.Group(),seams=new T.Group(),supports=new T.Group();
  pipes.name='parallel-hollow-tubes';seams.name='weld-seams';supports.name='support-jig';root.add(pipes,seams,supports);
  const steel=steelMaterial('oxide-steel'),bore=steelMaterial('unpolished-bore','#8a8c86',{roughness:1,metalness:.64});
  const cut=new T.MeshStandardMaterial({name:'cut-steel-lip',color:'#b2b5b3',metalness:.82,roughness:.53,normalMap:steelMaps().normalMap,normalScale:new T.Vector2(.32,.32)});
  const weldMat=new T.MeshStandardMaterial({name:'deposited-steel-weld',color:'#bbc5c8',metalness:.65,roughness:.42,normalMap:steelMaps().normalMap,normalScale:new T.Vector2(.18,.18)});
  for(let i=0;i<count;i++){
    const y=(i-(count-1)/2)*pitch,pipe=addMesh(pipes,`steel-pipe-${i+1}`,pipeGeometry(length,radius,radius-wall,i*.719),[steel,bore,cut]);
    pipe.position.y=y;pipe.userData={id:`pipe-${i+1}`,outerDiameter:diameter,wall,openEnds:true,length};
    if(i===count-1)continue;
    const middle=y+pitch/2;
    {
      const seam=new T.Group();seam.name=`long-seam-${i+1}`;seam.position.set(0,middle,0);seams.add(seam);
      const beadCount=Math.max(3,Math.round(runLength/.17)),spacing=runLength/beadCount,beadLength=Math.min(.032,spacing*.28);
      const crownZ=radius*.4+.0026;
      seam.userData={id:seam.name,pipeIds:[`pipe-${i+1}`,`pipe-${i+2}`],start:[-runLength/2,0,crownZ],end:[runLength/2,0,crownZ],normal:[0,0,1],welded:false,beadCount,beadLength,joining:'pipe-to-pipe'};
      for(let k=0;k<beadCount;k++){
        const x=-runLength/2+(k+.5)*spacing;
        const deposit=new T.Group();deposit.name=`${seam.name}-deposit-${String(k+1).padStart(2,'0')}`;deposit.position.x=x;
        deposit.userData={startX:x-beadLength/2,endX:x+beadLength/2,ordinal:k+1};deposit.visible=false;seam.add(deposit);
        addMesh(deposit,'weld-bridge',beadGeometry(beadLength,radius,pitch,k*.71+i),weldMat);
      }
    }
  }
  const fixture=steelMaterial('jig-oxidised-steel','#978777',{metalness:.8});
  const width=(count-1)*pitch+diameter+.12,beamHeight=.074;
  for(const [i,x] of [-length*.32,length*.32].entries()){
    const beam=new T.Group();beam.name=`support-crossbar-${i+1}`;beam.position.x=x;supports.add(beam);
    box(beam,'top-flange',[.074,width,.007],[0,0,-radius-.0035],fixture);
    box(beam,'beam-web',[.008,width,beamHeight-.014],[0,0,-radius-beamHeight/2],fixture);
    box(beam,'bottom-flange',[.074,width,.007],[0,0,-radius-beamHeight+.0035],fixture);
    for(const y of [-width*.35,width*.35])box(beam,'support-pad',[.11,.08,.025],[0,y,-radius-beamHeight-.0125],fixture);
  }
  root.updateMatrixWorld(true);return root;
}

/** Static appearance comparison only. Live deposits use appendPanelWeldContact. */
export function setPanelWeldPreview(panel,welded){
  const seams=panel.getObjectByName('weld-seams').children;
  for(const seam of seams){
    seam.userData.welded=!!welded;
    for(const deposit of seam.children)deposit.visible=!!welded;
  }
  panel.userData.state=welded?'welded-preview':'unwelded';
}

const traceStates=new WeakMap();
export function clearPanelWeldTrace(panel){
  const previous=traceStates.get(panel);
  if(previous){for(const mesh of previous.group.children)mesh.geometry.dispose();panel.remove(previous.group);}
  traceStates.delete(panel);delete panel.userData.depositedLength;setPanelWeldPreview(panel,false);
}

/**
 * Deposit at an ACTUAL arc-contact point, in panel-local metres. The caller must
 * derive this from the accepted tool pose, not from a planned path or a timer.
 * This workpiece has straight pipe seams; points outside their contact corridor
 * break the arc. No free-space trail, stopped-tip growth, or gap interpolation.
 */
function finishWeldGeometry(stroke){
  if(!stroke?.mesh||!stroke.dirty)return;
  const geometry=stroke.mesh.geometry,fullIndex=geometry.index;
  geometry.setIndex(new T.BufferAttribute(fullIndex.array.subarray(0,geometry.drawRange.count),1));geometry.computeVertexNormals();geometry.setIndex(fullIndex);
  geometry.computeBoundingSphere();geometry.computeBoundingBox();stroke.dirty=false;
}
export function appendPanelWeldContact(panel,{seamId,position,arcOn,maxSampleDistance=.025,deferGeometry=false}){
  let state=traceStates.get(panel);
  if(!state){
    setPanelWeldPreview(panel,false);
    const group=new T.Group();group.name='trajectory-weld-deposits';panel.add(group);
    state={group,active:null,totalLength:0,strokes:0};traceStates.set(panel,state);
  }
  const result=reason=>({depositedLength:state.totalLength,strokes:state.strokes,active:!!state.active,reason});
  if(!arcOn){finishWeldGeometry(state.active);state.active=null;panel.userData.state=state.totalLength?'welded-trace':'unwelded';return result('arc-off');}
  const seam=panel.getObjectByName('weld-seams').children.find(s=>s.name===seamId);
  if(!seam||!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw new Error('A valid seam and measured contact point are required');
  if(!Number.isFinite(maxSampleDistance)||maxSampleDistance<=0)throw new Error('Invalid contact sampling distance');
  const [x,y,z]=position,radius=panel.userData.diameter/2,pitch=panel.userData.pitch;
  const expectedZ=radius*.4+.0026;
  if(x<seam.userData.start[0]||x>seam.userData.end[0]||Math.abs(y-seam.position.y)>.0015||Math.abs(z-expectedZ)>.002){
    finishWeldGeometry(state.active);state.active=null;panel.userData.state=state.totalLength?'welded-trace':'unwelded';return result('outside-seam-contact');
  }
  const previous=state.active,delta=previous?x-previous.lastX:0;
  if(previous&&(previous.seamId!==seamId||Math.abs(delta)>maxSampleDistance||(previous.direction&&delta*previous.direction<-.00005))){finishWeldGeometry(previous);state.active=null;}
  if(!state.active){
    // A single stationary contact has zero length: no pre-made bead appears.
    state.active={seamId,lastX:x,startX:x,direction:0,travel:0,ringCount:0,capacity:0,mesh:null};
    panel.userData.state='welding';return result('contact-start');
  }
  const stroke=state.active,distance=Math.abs(x-stroke.lastX);
  if(distance<1e-7){if(!deferGeometry)finishWeldGeometry(stroke);return result('stationary');}
  stroke.direction=Math.sign(x-stroke.lastX);
  if(!stroke.mesh){
    const mat=seam.children[0].children[0].material;
    stroke.mesh=addMesh(state.group,`measured-weld-stroke-${++state.strokes}`,new T.BufferGeometry(),mat);
    stroke.mesh.userData={seamId,source:'accepted-tool-contact',startX:stroke.startX,endX:stroke.startX,depositedLength:0};
  }
  const steps=Math.max(1,Math.ceil(distance/.0006)),ringSize=32;
  const required=stroke.ringCount+steps+(stroke.ringCount===0?1:0);
  if(required>stroke.capacity){
    const capacity=Math.max(64,2**Math.ceil(Math.log2(required))),old=stroke.mesh.geometry;
    const geometry=new T.BufferGeometry(),p=new Float32Array(capacity*ringSize*3),uv=new Float32Array(capacity*ringSize*2),indices=new Uint32Array((capacity-1)*(ringSize-1)*6+2*(ringSize-3)*3);
    if(old.attributes.position){p.set(old.attributes.position.array);uv.set(old.attributes.uv.array);}
    for(let i=0;i<capacity-1;i++)for(let j=0;j<ringSize-1;j++){
      const a=i*ringSize+j,b=a+ringSize,k=(i*(ringSize-1)+j)*6;
      indices.set(stroke.direction>0?[a,b,a+1,b,b+1,a+1]:[a,a+1,b,b,a+1,b+1],k);
    }
    geometry.setAttribute('position',new T.BufferAttribute(p,3).setUsage(T.DynamicDrawUsage));
    geometry.setAttribute('uv',new T.BufferAttribute(uv,2).setUsage(T.DynamicDrawUsage));geometry.setIndex(new T.BufferAttribute(indices,1));
    stroke.mesh.geometry=geometry;old.dispose();stroke.capacity=capacity;
  }
  const geometry=stroke.mesh.geometry,positionBuffer=geometry.attributes.position,uvBuffer=geometry.attributes.uv;
  const appendRing=(atX,travel)=>{
    const rootZ=.0012,fade=Math.min(1,travel/.003),toe=rootZ+.0003+(radius*.4-rootZ-.0003)*fade;
    const halfWidth=z=>pitch/2-Math.sqrt(radius*radius-z*z)+.00015,ring=[];
    for(let j=0;j<=14;j++){
      const s=j/14*2-1,ripple=1+.10*Math.sin(travel/.0019*tau+s*s*2.8);
      ring.push([s*halfWidth(toe),toe+.0026*(1-s*s)*fade*ripple]);
    }
    for(let j=1;j<=8;j++){const h=T.MathUtils.lerp(toe,rootZ,j/8);ring.push([halfWidth(h),h]);}
    ring.push([-halfWidth(rootZ),rootZ]);
    for(let j=1;j<=8;j++){const h=T.MathUtils.lerp(rootZ,toe,j/8);ring.push([-halfWidth(h),h]);}
    for(let j=0;j<ringSize;j++){
      const k=stroke.ringCount*ringSize+j;positionBuffer.setXYZ(k,atX,seam.position.y+ring[j][0],ring[j][1]);uvBuffer.setXY(k,travel/.018,j/ringSize);
    }
    stroke.ringCount++;
  };
  const oldRingCount=stroke.ringCount;
  if(stroke.ringCount===0)appendRing(stroke.lastX,0);
  for(let i=1;i<=steps;i++)appendRing(T.MathUtils.lerp(stroke.lastX,x,i/steps),stroke.travel+distance*i/steps);
  stroke.travel+=distance;stroke.lastX=x;state.totalLength+=distance;
  const indexBuffer=geometry.index.array;
  // Refill body indices previously occupied by the advancing end cap.
  for(let i=Math.max(0,oldRingCount-1);i<stroke.ringCount-1;i++)for(let j=0;j<ringSize-1;j++){
    const a=i*ringSize+j,b=a+ringSize,k=(i*(ringSize-1)+j)*6;
    indexBuffer.set(stroke.direction>0?[a,b,a+1,b,b+1,a+1]:[a,a+1,b,b,a+1,b+1],k);
  }
  let indexCount=(stroke.ringCount-1)*(ringSize-1)*6;
  for(const end of [0,stroke.ringCount-1])for(let j=1;j<ringSize-2;j++){
    const a=end*ringSize,forward=(end===0)===(stroke.direction>0);
    indexBuffer.set(forward?[a,a+j,a+j+1]:[a,a+j+1,a+j],indexCount);indexCount+=3;
  }
  geometry.index.needsUpdate=true;geometry.setDrawRange(0,indexCount);
  positionBuffer.needsUpdate=true;uvBuffer.needsUpdate=true;
  stroke.dirty=true;if(!deferGeometry)finishWeldGeometry(stroke);
  stroke.mesh.userData.endX=x;stroke.mesh.userData.depositedLength=stroke.travel;
  panel.userData.state='welding';panel.userData.depositedLength=state.totalLength;
  return result('deposited');
}
