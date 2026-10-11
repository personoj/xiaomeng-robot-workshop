import * as T from 'three';

// Optical approximation of the user's live arc-welding photograph. Metres,
// world-space contact points, no baked weld path and no frame-rate dependent emitters.
const billboardVertex = /* glsl */`
  varying vec2 vUv;
  uniform float size;
  void main(){
    vUv=uv;
    vec4 centre=modelViewMatrix*vec4(0.0,0.0,0.0,1.0);
    centre.xy+=position.xy*size;
    gl_Position=projectionMatrix*centre;
  }
`;
const arcFragment = /* glsl */`
  varying vec2 vUv;
  uniform float phase;
  uniform float strength;
  uniform float seed;
  float thinRay(vec2 p,float angle,float reach,float width){
    vec2 axis=vec2(cos(angle),sin(angle));
    float along=dot(p,axis),crosswise=dot(p,vec2(-axis.y,axis.x));
    return exp(-crosswise*crosswise/(width*width))*
      exp(-max(along,0.0)/reach)*step(0.0,along);
  }
  void main(){
    vec2 p=(vUv-.5)*2.0;
    float r=length(p);
    // Compact clipped white core, cyan corona and irregular, thin radial spokes.
    float core=exp(-r*r*310.0);
    float corona=exp(-r*r*96.0)*.78;
    float shoulder=exp(-r*r*28.0)*.055;
    float jitter=.012*sin(phase*17.0+seed);
    // A few unequal, fine rays, rather than a regular many-pointed star/disk.
    float ray=thinRay(p,-.64+jitter,.63,.0060)*.86;
    ray+=thinRay(p,1.06-jitter,.47,.0045)*.59;
    ray+=thinRay(p,2.78+jitter,.38,.0065)*.46;
    ray+=thinRay(p,-1.91-jitter,.53,.0038)*.71;
    ray+=thinRay(p,.30+jitter,.26,.0048)*.32;
    ray+=thinRay(p,-2.40-jitter,.28,.0050)*.38;
    ray*=smoothstep(.025,.067,r);
    float flicker=.90+.07*sin(phase*81.0)+.03*sin(phase*137.0+seed);
    float mask=1.0-smoothstep(.82,1.0,r);
    float energy=corona+shoulder+ray+core;
    vec3 color=(vec3(.23,.77,1.0)*(corona+shoulder+ray)+
      vec3(1.0,.995,1.0)*core)/max(.00001,energy);
    // Keep radial falloff in alpha, so output color conversion doesn't broaden
    // the corona into a clipped disk around the surrounding pipe surfaces.
    gl_FragColor=vec4(color*(1.0+core*6.0),min(1.0,energy)*mask*strength*flicker);
    #include <colorspace_fragment>
  }
`;
const hazeFragment = /* glsl */`
  varying vec2 vUv;
  uniform float strength;
  void main(){
    float r=length((vUv-.5)*2.0);
    float a=exp(-r*r*6.0)*.034*(1.0-smoothstep(.70,1.0,r));
    gl_FragColor=vec4(vec3(.13,.64,1.0),a*strength);
    #include <colorspace_fragment>
  }
`;
const smokeVertex = /* glsl */`
  attribute float opacity;
  attribute float particleSize;
  attribute float rotation;
  attribute float particleSeed;
  attribute float illuminated;
  uniform float pixelScale;
  varying float vOpacity;
  varying float vRotation;
  varying float vSeed;
  varying float vLight;
  void main(){
    vec4 mv=modelViewMatrix*vec4(position,1.0);
    gl_Position=projectionMatrix*mv;
    gl_PointSize=clamp(particleSize*pixelScale/max(.01,-mv.z),1.0,300.0);
    vOpacity=opacity;vRotation=rotation;vSeed=particleSeed;vLight=illuminated;
  }
`;
const smokeFragment = /* glsl */`
  varying float vOpacity;
  varying float vRotation;
  varying float vSeed;
  varying float vLight;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){
    vec2 i=floor(p), f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
               mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
  }
  float fbm(vec2 p){
    return .57*noise(p)+.28*noise(p*2.07+8.1)+.15*noise(p*4.31+3.7);
  }
  void main(){
    vec2 p=(gl_PointCoord-.5)*2.0;
    float cs=cos(vRotation), sn=sin(vRotation);
    p=mat2(cs,-sn,sn,cs)*p;
    // Domain-warped wisps and holes make each puff irregular, not a Gaussian bead.
    vec2 warp=vec2(fbm(p*2.7+vSeed),fbm(p*2.7+vSeed+23.7))-.5;
    p+=warp*.46;
    p.x*=.77+.19*sin(vSeed);
    float n=fbm(p*3.3+vSeed);
    float body=exp(-dot(p,p)*2.1);
    float edge=1.0-smoothstep(.56,.98,length(p)+.20*(n-.5));
    float clumps=smoothstep(.29,.72,n);
    float a=body*edge*clumps*vOpacity;
    if(a<.001)discard;
    vec3 base=vec3(.16,.235,.30);
    vec3 lit=vec3(.25,.55,.79);
    gl_FragColor=vec4(mix(base,lit,vLight)*( .87+n*.20),a);
    #include <colorspace_fragment>
  }
`;
const sparkVertex = /* glsl */`
  attribute vec3 particleColor;
  attribute float opacity;
  varying vec3 vColor;
  varying float vOpacity;
  void main(){vColor=particleColor;vOpacity=opacity;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
const sparkFragment = /* glsl */`
  varying vec3 vColor;varying float vOpacity;
  void main(){gl_FragColor=vec4(vColor*vOpacity,1.0);
    #include <colorspace_fragment>
  }
`;

function vector(value, target){
  if(value?.isVector3)return target.copy(value);
  if(Array.isArray(value)||ArrayBuffer.isView(value))return target.fromArray(value);
  throw new TypeError('Welding effects require a Vector3 or [x, y, z].');
}
function finiteVector(v){return Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.z);}
function makeGeometry(count, attributes){
  const geometry=new T.BufferGeometry();
  for(const [name,size] of Object.entries(attributes)){
    const attribute=new T.BufferAttribute(new Float32Array(count*size),size);
    attribute.setUsage(T.DynamicDrawUsage);geometry.setAttribute(name,attribute);
  }
  return geometry;
}
function seeded(seed){
  let state=seed>>>0;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}

/**
 * createWeldingEffects({ scene?, up?, wind?, scale?, seed?, maxSparks?, maxSmoke? })
 *
 * update({ point, direction, arcOn, dt, intensity? }) receives WORLD coordinates.
 * `direction` points from the contact towards the nozzle (not into the workpiece).
 * Attach root to an untransformed scene; world-space particle positions stay behind
 * as the torch moves. Call update even while arcOn=false to let existing smoke fade.
 * setViewport(heightInPhysicalPixels, verticalFovInDegrees) preserves smoke sizes.
 * This only renders light/particles; the accepted contact trace owns deposited metal.
 */
export function createWeldingEffects({
  scene,up=[0,0,1],wind=[.042,-.014,0],scale=1,seed=94,
  maxSparks=96,maxSmoke=112,
}={}){
  if(!(scale>0&&Number.isFinite(scale)))throw new RangeError('scale must be finite and positive.');
  maxSparks=Math.max(8,Math.min(512,Math.floor(maxSparks)));
  maxSmoke=Math.max(8,Math.min(256,Math.floor(maxSmoke)));
  const root=new T.Group();root.name='live-welding-effects';
  root.userData={kind:'optical-effects',source:'user welding photograph',units:'metres'};
  const worldUp=vector(up,new T.Vector3()).normalize();
  if(!finiteVector(worldUp)||worldUp.lengthSq()<.5)throw new RangeError('up must be a finite nonzero vector.');
  const breeze=vector(wind,new T.Vector3()).multiplyScalar(scale);
  if(!finiteVector(breeze))throw new RangeError('wind must be finite.');
  const plumeSide=breeze.clone().projectOnPlane(worldUp);
  if(plumeSide.lengthSq()<1e-8){
    plumeSide.set(1,0,0).projectOnPlane(worldUp);
    if(plumeSide.lengthSq()<1e-8)plumeSide.set(0,1,0).projectOnPlane(worldUp);
  }
  plumeSide.normalize();
  const plumeCross=new T.Vector3().crossVectors(worldUp,plumeSide).normalize();
  const random=seeded(seed),point=new T.Vector3(),normal=new T.Vector3(0,0,1);
  const side=new T.Vector3(),otherSide=new T.Vector3(),helper=new T.Vector3();
  const resources=[];
  const arc=new T.Group();arc.name='white-blue-arc';root.add(arc);
  const quad=new T.PlaneGeometry(1,1);resources.push(quad);
  const coreMaterial=new T.ShaderMaterial({
    vertexShader:billboardVertex,fragmentShader:arcFragment,
    uniforms:{size:{value:.22*scale},phase:{value:0},strength:{value:1},seed:{value:seed}},
    transparent:true,depthWrite:false,depthTest:false,blending:T.AdditiveBlending,
    toneMapped:false,
  });
  const hazeMaterial=new T.ShaderMaterial({
    vertexShader:billboardVertex,fragmentShader:hazeFragment,
    uniforms:{size:{value:.26*scale},strength:{value:1}},
    transparent:true,depthWrite:false,depthTest:false,blending:T.AdditiveBlending,
    toneMapped:false,
  });
  resources.push(coreMaterial,hazeMaterial);
  const core=new T.Mesh(quad,coreMaterial),haze=new T.Mesh(quad,hazeMaterial);
  core.name='arc-core-and-spokes';haze.name='subtle-cyan-halo';
  core.frustumCulled=haze.frustumCulled=false;
  core.renderOrder=8;haze.renderOrder=7;arc.add(haze,core);arc.visible=false;
  // The light has a short range. Brightness falls rapidly on the nozzle and tubes.
  const light=new T.PointLight('#7cd9ff',0,.36*scale,2);
  light.name='local-arc-reflection';light.castShadow=false;root.add(light);
  resources.push(light);

  const sparkGeometry=makeGeometry(maxSparks*2,{position:3,particleColor:3,opacity:1});
  const sparkMaterial=new T.ShaderMaterial({
    vertexShader:sparkVertex,fragmentShader:sparkFragment,
    transparent:true,depthWrite:false,depthTest:true,
    blending:T.AdditiveBlending,toneMapped:false,
  });
  const sparks=new T.LineSegments(sparkGeometry,sparkMaterial);
  sparks.name='short-metal-sparks';sparks.frustumCulled=false;sparks.renderOrder=6;
  root.add(sparks);resources.push(sparkGeometry,sparkMaterial);
  const sparkPool=Array.from({length:maxSparks},()=>({
    position:new T.Vector3(),velocity:new T.Vector3(),age:0,life:0,
  }));
  const smokeGeometry=makeGeometry(maxSmoke,{
    position:3,opacity:1,particleSize:1,rotation:1,particleSeed:1,illuminated:1,
  });
  const smokeMaterial=new T.ShaderMaterial({
    vertexShader:smokeVertex,fragmentShader:smokeFragment,
    uniforms:{pixelScale:{value:900}},
    transparent:true,depthWrite:false,depthTest:true,
    blending:T.NormalBlending,toneMapped:false,
  });
  const smoke=new T.Points(smokeGeometry,smokeMaterial);
  smoke.name='blue-grey-fume';smoke.frustumCulled=false;smoke.renderOrder=5;
  root.add(smoke);resources.push(smokeGeometry,smokeMaterial);
  const smokePool=Array.from({length:maxSmoke},()=>({
    position:new T.Vector3(),velocity:new T.Vector3(),age:0,life:0,
    size:0,rotation:0,seed:0,curlPhase:0,density:0,
  }));
  let disposed=false,time=0,wasOn=false,sparkCursor=0,smokeCursor=0,
    sparkBudget=0,smokeBudget=0,sparksEmitted=0,smokeEmitted=0;
  const summary={arcOn:false,activeSparks:0,activeSmoke:0,sparksEmitted:0,smokeEmitted:0};
  if(scene)scene.add(root);

  function emitSpark(){
    const p=sparkPool[sparkCursor++%maxSparks];
    p.position.copy(point).addScaledVector(normal,.0015*scale);
    const angle=random()*Math.PI*2, lateral=(.16+random()*.46)*scale;
    p.velocity.copy(side).multiplyScalar(Math.cos(angle)*lateral)
      .addScaledVector(otherSide,Math.sin(angle)*lateral)
      .addScaledVector(normal,(.035+random()*.14)*scale);
    p.age=0;p.life=.09+random()*.18;sparksEmitted++;
  }
  function emitSmoke(){
    const p=smokePool[smokeCursor++%maxSmoke];
    p.position.copy(point).addScaledVector(normal,(.006+random()*.006)*scale);
    p.position.addScaledVector(side,(random()-.5)*.008*scale);
    p.velocity.copy(worldUp).multiplyScalar((.052+random()*.073)*scale)
      .addScaledVector(normal,.020*scale).add(breeze)
      .addScaledVector(plumeCross,(random()-.5)*.015*scale);
    p.age=0;p.life=1.7+random()*1.1;p.size=(.018+random()*.018)*scale;
    p.rotation=random()*Math.PI*2;p.seed=random()*80;
    // Neighbouring puffs share a broad curl and concentration pulse, but retain
    // different sizes/speeds. That forms separated, leaning smoke clusters.
    p.curlPhase=time*3.7+random()*.65;
    const pulse=.5+.5*Math.sin(time*6.1+.6*Math.sin(time*2.4));
    p.density=(.09+.13*pulse)*(.65+random()*.50);smokeEmitted++;
  }
  function syncParticles(){
    const sp=sparkGeometry.attributes,sm=smokeGeometry.attributes;
    let activeSparks=0,activeSmoke=0;
    for(let i=0;i<maxSparks;i++){
      const p=sparkPool[i],alive=p.life>p.age;
      const a=alive?Math.pow(1-p.age/p.life,.72):0;
      if(alive)activeSparks++;
      const h=alive?p.age/p.life:1;
      const r=1,g=.96-h*.48,b=.78-h*.64;
      helper.copy(p.velocity).normalize().multiplyScalar(Math.min(.022*scale,p.velocity.length()*.024));
      const idx=i*2;
      sp.position.setXYZ(idx,p.position.x,p.position.y,p.position.z);
      sp.position.setXYZ(idx+1,p.position.x-helper.x,p.position.y-helper.y,p.position.z-helper.z);
      sp.particleColor.setXYZ(idx,r,g,b);sp.particleColor.setXYZ(idx+1,r,g,b);
      sp.opacity.setX(idx,a*.65);sp.opacity.setX(idx+1,a*.06);
    }
    for(let i=0;i<maxSmoke;i++){
      const p=smokePool[i],alive=p.life>p.age;
      const h=alive?p.age/p.life:1;
      if(alive)activeSmoke++;
      const fade=alive?Math.sin(Math.PI*h)**.75:0;
      sm.position.setXYZ(i,p.position.x,p.position.y,p.position.z);
      sm.opacity.setX(i,fade*p.density);
      sm.particleSize.setX(i,p.size*(1+h*(2.4+.7*Math.sin(p.seed))));
      sm.rotation.setX(i,p.rotation+p.age*(.22+.13*Math.sin(p.seed)));
      sm.particleSeed.setX(i,p.seed+p.age*.28);
      // Existing fume loses cyan illumination immediately when the arc stops.
      sm.illuminated.setX(i,wasOn?Math.exp(-point.distanceTo(p.position)/(.23*scale))*.95:0);
    }
    for(const a of Object.values(sp))a.needsUpdate=true;
    for(const a of Object.values(sm))a.needsUpdate=true;
    Object.assign(summary,{arcOn:wasOn,activeSparks,activeSmoke,sparksEmitted,smokeEmitted});
  }

  const sight=new T.Raycaster(),eye=new T.Vector3(),sightDirection=new T.Vector3();
  let sightTime=0,visibleArc=true;
  function update({point:contact,direction,arcOn=false,dt=0,intensity=1,camera,occluders=[]}={}){
    if(disposed)throw new Error('Welding effects have been disposed.');
    if(!Number.isFinite(dt)||dt<0)throw new RangeError('dt must be finite and nonnegative.');
    if(!Number.isFinite(intensity)||intensity<0)throw new RangeError('intensity must be finite and nonnegative.');
    if(contact!==undefined)vector(contact,point);
    if(direction!==undefined)vector(direction,normal);
    if(!finiteVector(point)||!finiteVector(normal)||normal.lengthSq()<1e-12)
      throw new RangeError('Contact/direction must be finite, with a nonzero direction.');
    normal.normalize();
    side.crossVectors(normal,worldUp);
    if(side.lengthSq()<.001)side.crossVectors(normal,new T.Vector3(1,0,0));
    if(side.lengthSq()<.001)side.crossVectors(normal,new T.Vector3(0,1,0));
    side.normalize();otherSide.crossVectors(normal,side).normalize();
    const active=Boolean(arcOn)&&intensity>0;
    if(!active){sparkBudget=0;smokeBudget=0;}
    // Long background-tab gaps age old particles but never generate a burst.
    const ageStep=Math.min(dt,4),emitStep=Math.min(dt,.05);
    time+=ageStep;wasOn=active;
    for(const p of sparkPool){
      if(p.life<=p.age)continue;
      p.age+=ageStep;
      p.position.addScaledVector(p.velocity,ageStep)
        .addScaledVector(worldUp,-.5*2.4*scale*ageStep*ageStep);
      p.velocity.addScaledVector(worldUp,-2.4*scale*ageStep);
    }
    for(const p of smokePool){
      if(p.life<=p.age)continue;
      p.age+=ageStep;p.position.addScaledVector(p.velocity,ageStep);
      const roll=p.curlPhase+p.age*2.8;
      p.position.addScaledVector(plumeSide,Math.sin(roll)*(.010+p.age*.017)*scale*ageStep)
        .addScaledVector(plumeCross,Math.cos(roll*.82)*(.005+p.age*.009)*scale*ageStep);
      p.velocity.addScaledVector(worldUp,.014*scale*ageStep);
      p.velocity.addScaledVector(breeze,.50*ageStep);
    }
    if(active){
      sparkBudget+=26*emitStep*Math.min(intensity,1.5);
      smokeBudget+=32*emitStep*Math.min(intensity,1.5);
      while(sparkBudget>=1){emitSpark();sparkBudget--;}
      while(smokeBudget>=1){emitSmoke();smokeBudget--;}
    }
    // The arc occupies the short gap between the metal and the nozzle. This offset
    // is inside that gap, allowing correct depth testing against the weld groove.
    arc.position.copy(point).addScaledVector(normal,.007*scale);arc.visible=active;
    // Optical glare is a lens effect, not a luminous sheet cutting into metal.
    // Test visibility of its source, then let its thin rays spread over the image.
    if(active&&camera&&time-sightTime>.05){
      sightTime=time;camera.getWorldPosition(eye);sightDirection.copy(arc.position).sub(eye);
      sight.set(eye,sightDirection.clone().normalize());sight.far=Math.max(0,sightDirection.length()-.0005*scale);
      const hits=sight.intersectObjects(occluders,true);
      const obstruction=hits.find(hit=>{
        if(hit.object.name==='projecting-weld-wire')return false;
        for(let p=hit.object;p;p=p.parent)if(!p.visible)return false;
        return true;
      });
      visibleArc=!obstruction;summary.occluder=obstruction?.object.name||obstruction?.object.type||'';
    }
    arc.visible=active&&(!camera||visibleArc);
    light.position.copy(point).addScaledVector(normal,.018*scale);
    const flicker=.95+.05*Math.sin(time*103);
    light.intensity=active?.18*scale*scale*intensity*flicker:0;
    coreMaterial.uniforms.phase.value=time;coreMaterial.uniforms.strength.value=intensity;
    hazeMaterial.uniforms.strength.value=intensity;
    summary.glareVisible=arc.visible;syncParticles();return {...summary};
  }
  function setViewport(height,verticalFov=45){
    if(!(Number.isFinite(height)&&height>0&&verticalFov>0&&verticalFov<180))
      throw new RangeError('Viewport height/FOV must be positive and finite.');
    smokeMaterial.uniforms.pixelScale.value=height/(2*Math.tan(T.MathUtils.degToRad(verticalFov)/2));
  }
  function clear(){
    for(const p of [...sparkPool,...smokePool])p.life=p.age=0;
    sparkBudget=smokeBudget=0;wasOn=false;arc.visible=false;light.intensity=0;syncParticles();
  }
  function dispose(){
    if(disposed)return;
    clear();root.removeFromParent();for(const resource of resources)resource.dispose();disposed=true;
  }
  return {root,light,update,setViewport,clear,dispose,getStats:()=>({...summary})};
}
