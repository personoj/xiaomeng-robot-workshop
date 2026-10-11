// FANUC arm: unmodified manufacturer mesh geometry and URDF joint origins.
// Chassis, welding accessories, and workpiece: custom brochure-based reconstruction.
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { CABLE_LENGTHS, fixedDressCurve, fixedGuide, createCableCollisionModel, updateTube } from './cable-constraints.js';

export const ASSET_ROOT = '/models/xiaomeng-h/';
export const HOME_POSE = [0, -62, -62, 0, -90, 0];
export const JOINT_LIMITS = [[-185,185],[-90,145],[-90,222],[-190,190],[-179.999,179.999],[-450,450]];
const V = (a) => new T.Vector3(...a);
const geometryCache=new Map();
function cached(key,create){if(!geometryCache.has(key))geometryCache.set(key,create());return geometryCache.get(key);}
const material = (color, metalness=.1, roughness=.42) => new T.MeshStandardMaterial({color, metalness, roughness});
function leatherNormal() {
  const size=128,heights=new Float32Array(size*size),pixels=new Uint8Array(size*size*4);
  let seed=4153;
  for(let i=0;i<heights.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;heights[i]=seed/4294967296;}
  const at=(x,y)=>heights[((y+size)%size)*size+(x+size)%size];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const n=new T.Vector3((at(x-1,y)-at(x+1,y))*.45,(at(x,y-1)-at(x,y+1))*.45,1).normalize(),i=(y*size+x)*4;
    pixels.set([(n.x*.5+.5)*255,(n.y*.5+.5)*255,(n.z*.5+.5)*255,255],i);
  }
  const texture=new T.DataTexture(pixels,size,size);texture.name='fine-vinyl-grain';
  texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(6,9);
  texture.magFilter=T.LinearFilter;texture.minFilter=T.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}
const vinylGrain=leatherNormal();
const mat = {
  yellow: new T.MeshPhysicalMaterial({color:'#e1af17',metalness:.12,roughness:.34,clearcoat:.28,clearcoatRoughness:.30}), gold: material('#c59b24',.16,.43),
  black: material('#22272a',.35,.42), rubber: material('#15191c',0,.86),
  seat: new T.MeshPhysicalMaterial({color:'#202225',metalness:0,roughness:.53,clearcoat:.18,clearcoatRoughness:.46,normalMap:vinylGrain,normalScale:new T.Vector2(.20,.20)}),
  seatInset: new T.MeshPhysicalMaterial({color:'#27292c',metalness:0,roughness:.59,clearcoat:.12,clearcoatRoughness:.50,normalMap:vinylGrain,normalScale:new T.Vector2(.18,.18)}),
  seatPiping:material('#424649',0,.58),seatShell: material('#1c2022',.02,.62), steel: material('#929ca3',.85,.28),
  darkSteel: material('#414b50',.65,.48), copper: material('#b87b4c',.85,.3),
  red: material('#b43527',.2,.36), white: material('#eeeade',.3,.4),
  glass: new T.MeshPhysicalMaterial({color:'#b52618',metalness:.05,roughness:.22,transmission:.45,thickness:.02}),
  frame:material('#626b65',.55,.48), seam:material('#141a19',.1,.85),
  brass:material('#b79855',.8,.3), olive:material('#73796b',.45,.66),
};

function mesh(parent,name,geometry,m,pos=[0,0,0]) {
  const o = new T.Mesh(geometry,m); o.name=name; o.position.fromArray(pos);
  o.castShadow=o.receiveShadow=true; parent.add(o); return o;
}
function box(p,n,s,c,m=mat.yellow,r=.008) {
  return mesh(p,n,cached(`box:${s}:${r}`,()=>new RoundedBoxGeometry(...s,2,Math.min(r,...s.map(x=>x*.48)))),m,c);
}
function cyl(p,n,r1,r2,length,c,m=mat.black,axis=[0,0,1],segments=40) {
  const o=mesh(p,n,cached(`cyl:${r1}:${r2}:${length}:${segments}`,()=>new T.CylinderGeometry(r1,r2,length,segments)),m,c);
  o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),V(axis)); return o;
}
function line(p,n,points,r,m=mat.black,ribbed=false) {
  const curve=Array.isArray(points)?new T.CatmullRomCurve3(points.map(V)):points;
  const o=mesh(p,n,new T.TubeGeometry(curve,Math.min(192,Math.max(64,(points.length||8)*20)),r,r>=.008?16:12,false),m);
  if(ribbed) {
    const rings=new T.InstancedMesh(new T.TorusGeometry(r*1.02,r*.13,5,12),m,110),dummy=new T.Object3D();
    rings.name=n+'-corrugations';rings.castShadow=rings.receiveShadow=true;
    for(let i=0;i<110;i++) {
      const t=i/109;dummy.position.copy(curve.getPoint(t));
      dummy.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),curve.getTangent(t));
      dummy.updateMatrix();rings.setMatrixAt(i,dummy.matrix);
    }
    p.add(rings);
  }
  return o;
}
function group(p,n,pos=[0,0,0]) {const g=new T.Group(); g.name=n;g.position.fromArray(pos);p.add(g);return g;}
function bolts(p,center,r,count=8,axis='z',bolt=.009) {
  for(let i=0;i<count;i++){
    const a=2*Math.PI*i/count, pos=[...center];
    const idx=axis==='y'?[0,2]:axis==='x'?[1,2]:[0,1];
    pos[idx[0]]+=Math.cos(a)*r;pos[idx[1]]+=Math.sin(a)*r;
    cyl(p,'fastener',bolt,bolt,.008,pos,mat.steel,axis==='y'?[0,1,0]:axis==='x'?[1,0,0]:[0,0,1],6);
  }
}
function label(p,font,text,size,pos,rotation=[Math.PI/2,0,0],m=mat.black) {
  if(!font)return;
  const o=mesh(p,'label-'+text,new TextGeometry(text,{font,size,depth:.0008,curveSegments:3,bevelEnabled:false}),m,pos);
  o.rotation.set(...rotation);return o;
}

function lathe(p,n,profile,c,m,axis=[0,0,1],segments=64) {
  const o=mesh(p,n,new T.LatheGeometry(profile.map(a=>new T.Vector2(...a)),segments),m,c);
  o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),V(axis));return o;
}
function ring(p,n,r,t,c,m=mat.black,axis=[0,1,0]){
  const o=mesh(p,n,cached(`torus:${r}:${t}`,()=>new T.TorusGeometry(r,t,8,64)),m,c);
  o.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),V(axis));return o;
}
function profileXZ(p,n,points,width,y,m=mat.yellow,bevel=.003) {
  const shape=new T.Shape(points.map(v=>new T.Vector2(...v)));
  const g=new T.ExtrudeGeometry(shape,{depth:width,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,steps:1});
  const o=mesh(p,n,g,m,[0,y+width/2,0]);o.rotation.x=Math.PI/2;return o;
}
function upholstery(p,n,size,pos,kind,m=mat.seat) {
  const geometry=new RoundedBoxGeometry(...size,8,Math.min(...size)*.44);
  const points=geometry.attributes.position;
  for(let i=0;i<points.count;i++){
    let x=points.getX(i),y=points.getY(i),z=points.getZ(i);
    if(kind==='cushion'){
      const top=T.MathUtils.smoothstep(z,0,size[2]*.38);
      // A shallow sitting pocket, raised sides and a soft waterfall front edge.
      z+=top*(.011*Math.pow(Math.abs(y)/(size[1]/2),2)-.012*Math.exp(-Math.pow(x/.16,2)-Math.pow(y/.16,2)));
      y*=1-.055*T.MathUtils.smoothstep(x,-.05,size[0]/2);
    }else{
      const front=1-T.MathUtils.smoothstep(x,-size[0]*.4,size[0]*.1);
      const side=Math.pow(Math.abs(y)/(size[1]/2),3);
      x-=front*(.014*side+.010*Math.exp(-Math.pow((z+.12)/.10,2)));
      y*=1-.065*T.MathUtils.smoothstep(z,.16,size[2]/2);
      x-=front*.006*Math.max(0,1-Math.pow(y/(size[1]/2),2))*Math.max(0,1-Math.pow(z/(size[2]/2),2));
    }
    points.setXYZ(i,x,y,z);
  }
  geometry.computeVertexNormals();return mesh(p,n,geometry,m,pos);
}
function paddedSeam(p,n,w,h,center,plane='back') {
  const shape=new T.Shape(),r=.015,x=w/2,y=h/2;
  shape.moveTo(-x+r,-y);shape.lineTo(x-r,-y);shape.quadraticCurveTo(x,-y,x,-y+r);
  shape.lineTo(x,y-r);shape.quadraticCurveTo(x,y,x-r,y);shape.lineTo(-x+r,y);
  shape.quadraticCurveTo(-x,y,-x,y-r);shape.lineTo(-x,-y+r);shape.quadraticCurveTo(-x,-y,-x+r,-y);
  const points=shape.getPoints(10).map(v=>plane==='back'?[center[0],center[1]+v.x,center[2]+v.y]:[center[0]+v.y,center[1]+v.x,center[2]]);
  line(p,n,points,.0009,mat.seatPiping);
}
function ventPanel(p,n,w,h,cols,rows,pos,rotation=[Math.PI/2,0,0]) {
  const g=group(p,n,pos);g.rotation.set(...rotation,'ZYX');
  const shape=new T.Shape([[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(v=>new T.Vector2(...v)));
  for(let row=0;row<rows;row++)for(let i=0;i<cols;i++){
    const cx=-w*.40+w*.80*(i+.5)/cols,cy=-h*.26+h*.52*(row+.5)/rows;
    const sw=w*.36/cols,sh=h*.43/rows;
    const hole=new T.Path();hole.moveTo(cx-sw/2,cy-sh/2);hole.lineTo(cx-sw/2,cy+sh/2);
    hole.lineTo(cx+sw/2,cy+sh/2);hole.lineTo(cx+sw/2,cy-sh/2);hole.closePath();shape.holes.push(hole);
  }
  mesh(g,'slotted-sheet',new T.ExtrudeGeometry(shape,{depth:.004,bevelEnabled:true,bevelSize:.0005,bevelThickness:.0005,bevelSegments:1}),mat.yellow);
  box(g,'dark-vent-interior',[w-.012,h-.012,.015],[0,0,-.018],mat.seam,.001);
  for(const x of [-1,1])for(const y of [-1,1]){
    cyl(g,'panel-screw',.004,.004,.004,[x*(w/2-.012),y*(h/2-.012),.006],mat.darkSteel,[0,0,1],8);
  }
  return g;
}
function instanceRepeats(parent) {
  for(const child of [...parent.children])if(child.isGroup)instanceRepeats(child);
  const batches=new Map();
  for(const child of parent.children){
    if(!child.isMesh||child.isInstancedMesh||Array.isArray(child.material))continue;
    const key=child.geometry.uuid+child.material.uuid;
    if(!batches.has(key))batches.set(key,[]);batches.get(key).push(child);
  }
  for(const items of batches.values())if(items.length>=4){
    const batch=new T.InstancedMesh(items[0].geometry,items[0].material,items.length);
    batch.name=items[0].name+'-instances';batch.castShadow=batch.receiveShadow=true;
    batch.userData.parts=items.map(o=>o.name);
    items.forEach((o,i)=>{o.updateMatrix();batch.setMatrixAt(i,o.matrix);parent.remove(o);});parent.add(batch);
  }
}

function wheel(p,x,y,font) {
  const housing=group(p,'road-wheel-assembly',[x,y,.255]);
  const g=group(housing,'road-wheel-rotor');
  lathe(g,'rounded-tyre-carcass',[[.155,-.068],[.181,-.078],[.219,-.077],[.241,-.063],[.252,-.041],[.254,0],[.252,.041],[.241,.063],[.219,.077],[.181,.078],[.155,.068],[.155,-.068]],[0,0,0],mat.rubber,[0,1,0],96);
  for(const side of [-1,1]) {
    const disk=group(g,'stamped-wheel',[0,side*.069,0]);disk.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),V([0,side,0]));
    lathe(disk,'rim-pressing',[[0,-.037],[.068,-.037],[.096,-.024],[.113,-.002],[.15,.002],[.164,.013],[.17,.009],[.172,-.008],[.15,-.014],[0,-.041]],[0,0,0],mat.black,[0,0,1]);
    const plate=new T.Shape();plate.absarc(0,0,.143,0,Math.PI*2,false);
    for(let i=0;i<8;i++) {
      const a=i*Math.PI/4, hole=new T.Path();hole.absarc(Math.cos(a)*.121,Math.sin(a)*.121,.017,0,Math.PI*2,true);plate.holes.push(hole);
    }
    mesh(disk,'ventilated-rim-plate',new T.ExtrudeGeometry(plate,{depth:.004,bevelEnabled:false}),mat.black,[0,0,-.009]);
    cyl(disk,'grease-cap',.035,.042,.025,[0,0,-.018],mat.darkSteel);
    bolts(disk,[0,0,-.005],.072,5,'z',.009);
    ring(g,'sidewall-bead',.187,.0018,[0,side*.079,0],mat.black);
    ring(g,'sidewall-shoulder',.224,.0013,[0,side*.074,0],mat.black);
    label(g,font,'145/70 R12',.015,[-.062,side*.079,.179],side<0?[Math.PI/2,0,0]:[Math.PI/2,Math.PI,0],mat.darkSteel);
  }
  for(let i=0;i<76;i++) {
    const a=i*2*Math.PI/76;
    for(const yy of [-.041,0,.041]) {
      const tread=box(g,'tyre-tread',[.014,.033,.006],[Math.sin(a)*.253,yy,Math.cos(a)*.253],mat.rubber,.001);
      tread.rotation.y=a;tread.rotateZ(yy>0?.40:-.40);
    }
  }
  const shape=new T.Shape();
  shape.absarc(0,0,.314,0,Math.PI,false);shape.lineTo(-.286,0);
  shape.absarc(0,0,.286,Math.PI,0,true);shape.closePath();
  const arch=mesh(housing,'yellow-mudguard',new T.ExtrudeGeometry(shape,{depth:.20,bevelEnabled:true,bevelThickness:.002,bevelSize:.002,bevelSegments:2,curveSegments:48}),mat.yellow,[0,.1,0]);
  arch.rotation.x=Math.PI/2;
  for(const xx of [-.225,.225])box(housing,'fender-bracket',[.032,.13,.03],[xx,0,.14],mat.darkSteel);
  instanceRepeats(housing);
}

function driverStation(g,font) {
  box(g,'recessed-footwell',[.78,.48,.035],[-.06,-.27,.30],mat.black);
  for(let i=0;i<16;i++)box(g,'anti-slip-floor-rib',[.019,.39,.007],[-.41+i*.047,-.27,.322],mat.rubber,.002);
  profileXZ(g,'folded-steering-support',[[-.49,.31],[-.25,.31],[-.33,.87],[-.48,.97],[-.57,.89]],.075,-.43);
  box(g,'steering-column-shaft',[.041,.046,.22],[-.44,-.30,.88],mat.darkSteel).rotation.y=.20;
  const steering=group(g,'steering-wheel',[-.47,-.30,1.003]);steering.rotation.y=.17;
  ring(steering,'soft-steering-rim',.162,.015,[0,0,0],mat.rubber,[0,0,1]);
  cyl(steering,'steering-hub',.036,.038,.035,[0,0,0]);
  cyl(steering,'hub-badge',.021,.021,.004,[0,0,.02],mat.frame);
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;line(steering,'steering-spoke',[[0,0,0],[Math.cos(a)*.154,Math.sin(a)*.154,0]],.012);}
  const console=group(g,'driver-controls',[-.37,-.37,.83]);console.rotation.y=-.20;
  box(console,'control-housing',[.23,.14,.115],[0,0,0],mat.yellow,.018);
  box(console,'instrument-face',[.19,.010,.080],[0,-.078,.005],mat.black);
  for(let i=0;i<3;i++){
    cyl(console,'toggle-escutcheon',.01,.01,.006,[-.064+i*.062,-.086,.012],mat.steel,[0,-1,0]);
    line(console,'switch-toggle',[[-.064+i*.062,-.09,.012],[-.064+i*.062,-.104,.033]],.0028,mat.black);
  }
  label(console,font,'DRIVE',.012,[-.036,-.087,-.030],[Math.PI/2,0,0],mat.white);
  const lever=group(g,'direction-lever',[-.52,-.40,.70]);
  cyl(lever,'lever-pivot',.016,.016,.033,[0,0,0]);line(lever,'lever-stem',[[0,0,0],[.016,0,.09]],.005,mat.steel);
  mesh(lever,'lever-knob',new T.SphereGeometry(.018,16,12),mat.rubber,[.016,0,.10]);
  box(g,'accelerator-pedal',[.11,.075,.014],[-.18,-.30,.35],mat.rubber,.003).rotation.y=-.22;
  for(let i=0;i<4;i++)box(g,'pedal-grip',[.09,.006,.003],[-.18,-.33+i*.016,.363],mat.darkSteel,.001);
  const seat=group(g,'suspension-seat',[.23,-.34,.78]);
  box(seat,'seat-yellow-platform',[.55,.49,.035],[-.065,0,-.050]);
  for(const y of [-.17,.17]) {
    box(seat,'seat-slider-rail',[.46,.035,.07],[-.07,y,-.13],mat.darkSteel);
    for(const x of [-.25,.08])cyl(seat,'suspension-spring',.025,.025,.11,[x,y,-.155],mat.black);
    for(const x of [-.26,.13])cyl(seat,'rail-lock',.008,.008,.018,[x,y,-.017],mat.steel,[0,0,1],6);
  }
  box(seat,'moulded-seat-pan',[.485,.451,.055],[-.063,0,.012],mat.seatShell,.024);
  upholstery(seat,'contoured-seat-cushion',[.49,.455,.085],[-.075,0,.074],'cushion');
  for(const y of [-.115,0,.115]){
    upholstery(seat,'stitched-sitting-panel',[.405,.109,.036],[-.088,y,.106],'cushion',mat.seatInset);
    paddedSeam(seat,'sitting-panel-stitch',.092,.361,[-.088,y,.121],'seat');
  }
  for(const y of [-.203,.203])upholstery(seat,'raised-thigh-bolster',[.444,.059,.075],[-.060,y,.093],'cushion');
  paddedSeam(seat,'cushion-perimeter-welt',.426,.441,[-.075,0,.106],'seat');
  const back=group(seat,'padded-backrest',[.155,0,.415]);back.rotation.y=.17;
  mesh(back,'continuous-back-shell',new RoundedBoxGeometry(.055,.451,.664,8,.025),mat.seatShell,[.045,0,0]);
  upholstery(back,'backrest-upholstery-foundation',[.112,.430,.645],[.003,0,0],'back');
  for(const [z,h,width] of [[.237,.155,.346],[.086,.132,.296],[-.058,.144,.287],[-.211,.150,.275]]){
    const x=z<0?-.035:-.024;
    upholstery(back,'segmented-backrest-cushion',[.074,width,h],[x,0,z],'back',mat.seatInset);
    paddedSeam(back,'backrest-panel-stitch',width-.032,h-.025,[x-.037,0,z]);
  }
  for(const y of [-.184,.184]){
    const bolster=upholstery(back,'sculpted-side-bolster',[.108,.077,.591],[-.033,y,-.018],'back');
    bolster.rotation.x=y>0?-.024:.024;
    line(back,'side-bolster-piping',[[-.062,y*.91,-.295],[-.073,y*.94,-.17],[-.074,y*.94,.06],[-.061,y*.92,.24]],.0014,mat.seatPiping);
  }
  // Belt webbing and shoulder guide on the visible outer flank.
  box(back,'seat-belt-webbing',[.031,.008,.432],[-.019,-.229,-.003],mat.rubber,.003);
  line(back,'shoulder-belt-guide',[[-.053,-.237,.132],[-.007,-.237,.132],[.001,-.237,.146],[-.007,-.237,.169],[-.053,-.237,.169],[-.060,-.237,.155],[-.053,-.237,.132]],.0026,mat.steel);
  for(const y of [-.229,.229]){
    profileXZ(seat,'seat-side-hinge',[[.072,.015],[.13,.035],[.202,.28],[.178,.305],[.145,.285],[.088,.12]],.012,y,mat.seatShell,.008);
    cyl(seat,'recline-pivot-cover',.028,.028,.014,[.115,y,.105],mat.seatShell,[0,1,0]);
    bolts(seat,[.115,y*1.06,.105],.018,3,'y',.004);
  }
  const buckle=group(seat,'seat-belt-buckle',[.061,-.243,.143]);buckle.rotation.y=-.28;
  box(buckle,'buckle-housing',[.047,.023,.050],[0,0,0],mat.seatShell,.006);
  box(buckle,'red-release-button',[.027,.021,.010],[-.006,0,.026],mat.red,.003);
  line(seat,'buckle-anchor',[[.09,-.228,.025],[.084,-.240,.081],[.065,-.243,.126]],.007,mat.rubber);
}

function gasSupply(g,font) {
  const bottle=group(g,'shielding-gas-cylinder',[.13,.35,.52]);
  lathe(bottle,'formed-steel-cylinder',[[0,0],[.072,0],[.098,.025],[.10,.09],[.10,.76],[.093,.805],[.070,.841],[.029,.86],[.028,.895],[0,.895]],[0,0,0],mat.olive,[0,0,1]);
  ring(bottle,'bottom-standing-ring',.09,.006,[0,0,.02],mat.darkSteel,[0,0,1]);
  for(const z of [.22,.64]) {
    lathe(bottle,'yellow-clamp-strap',[[.101,-.014],[.108,-.014],[.108,.014],[.101,.014],[.101,-.014]],[0,0,z],mat.yellow,[0,0,1]);
    box(bottle,'strap-anchor',[.04,.045,.034],[0,.12,z],mat.yellow);
    cyl(bottle,'strap-lock',.007,.007,.044,[.01,.15,z],mat.steel,[1,0,0],6);
  }
  box(bottle,'bottle-support-post',[.034,.04,.68],[0,.14,.36]);
  const valve=group(bottle,'gas-regulator',[0,0,.915]);
  cyl(valve,'neck-nut',.026,.026,.027,[0,0,-.006],mat.brass,[0,0,1],6);
  box(valve,'brass-valve-body',[.062,.032,.042],[.012,0,.016],mat.brass,.005);
  cyl(valve,'valve-stem',.009,.009,.045,[0,0,.048],mat.steel);
  ring(valve,'valve-handwheel',.029,.005,[0,0,.074],mat.black,[0,0,1]);
  for(let i=0;i<4;i++) {const a=i*Math.PI/2;line(valve,'handwheel-spoke',[[0,0,.074],[Math.cos(a)*.025,Math.sin(a)*.025,.074]],.003);}
  for(const [x,z] of [[-.035,.087],[.055,.048]]){
    const gauge=group(valve,'pressure-gauge',[x,-.032,z]);gauge.rotation.x=Math.PI/2;
    cyl(gauge,'gauge-metal-bezel',.036,.036,.023,[0,0,0],mat.steel);
    cyl(gauge,'printed-gauge-face',.030,.030,.002,[0,0,.013],mat.white);
    for(let i=0;i<17;i++){
      const a=(-135+i*270/16)*Math.PI/180;
      const tick=box(gauge,'gauge-scale-mark',[.0012,.004,.0008],[Math.sin(a)*.024,Math.cos(a)*.024,.015],mat.black,.0002);tick.rotation.z=-a;
    }
    line(gauge,'gauge-needle',[[0,0,.017],[-.012,.015,.017]],.001,mat.red);
    cyl(gauge,'needle-pin',.002,.002,.0015,[0,0,.017],mat.black);
    label(gauge,font,'MPa',.005,[-.006,-.015,.015],[0,0,0],mat.black);
  }
  cyl(valve,'hose-connector',.011,.011,.038,[.052,0,.014],mat.brass,[1,0,0],6);
  line(g,'gas-hose',[[.215,.35,1.45],[.31,.42,1.26],[.37,.40,.81],[.76,.35,.74]],.008,mat.black);
  const coil=group(g,'red-service-hose-coil',[.27,.15,.863]);
  const turns=8,points=[];
  for(let i=0;i<=turns*48;i++){
    const t=i/(turns*48),angle=t*turns*Math.PI*2;
    points.push(V([t*.152,Math.cos(angle)*.060,Math.sin(angle)*.060]));
  }
  const helix=new T.CatmullRomCurve3(points);
  mesh(coil,'continuous-coiled-service-hose',new T.TubeGeometry(helix,turns*80,.006,12,false),mat.red);
  line(coil,'hose-inlet-tail',[[0,.060,0],[-.012,.058,-.025],[-.016,.025,-.041],[-.015,-.014,-.041]],.006,mat.red);
  line(coil,'hose-outlet-tail',[[.152,.060,0],[.17,.055,.024],[.191,.02,.002],[.194,-.045,-.035]],.006,mat.red);
  cyl(coil,'service-quick-coupler',.009,.009,.020,[.194,-.054,-.040],mat.brass,[0,-.9,-.43],6);
  for(const x of [.027,.123])box(coil,'hose-rest',[.021,.10,.008],[x,0,-.070],mat.rubber,.004);
}

function cabinet(g,font) {
  profileXZ(g,'rear-lower-cabinet',[[.47,.52],[1.19,.52],[1.19,1.025],[.65,1.025],[.48,.84]],.96,0,mat.yellow,.012);
  profileXZ(g,'side-service-door',[[.52,.56],[1.158,.56],[1.158,.975],[.67,.975],[.53,.81]],.012,-.491,mat.gold,.004);
  line(g,'cabinet-door-gasket',[[.52,-.500,.565],[1.155,-.500,.565],[1.155,-.500,.975],[.67,-.500,.975],[.53,-.500,.81]],.003,mat.seam);
  for(const x of [.59,1.09])cyl(g,'cabinet-bolt',.005,.005,.007,[x,-.506,.59],mat.darkSteel,[0,-1,0],6);
  for(const z of [1.145,1.390]){
    box(g,'equipment-chassis-core',[.57,.82,.222],[.878,.075,z],mat.black,.010);
    box(g,'equipment-top-fold',[.588,.852,.016],[.878,.075,z+.114],mat.yellow);
    box(g,'equipment-bottom-fold',[.588,.852,.014],[.878,.075,z-.114],mat.yellow);
    ventPanel(g,'side-vented-enclosure',.55,.215,23,2,[.878,-.351,z]);
    ventPanel(g,'rear-vented-enclosure',.80,.215,29,2,[1.170,.075,z],[Math.PI/2,0,Math.PI/2]);
    box(g,'cabinet-inner-side',[.56,.01,.214],[.878,.500,z]);
    box(g,'cabinet-front-face',[.014,.82,.214],[.583,.075,z]);
    for(const y of [-.25,.34])box(g,'case-corner-protector',[.022,.028,.20],[1.17,y,z],mat.darkSteel,.005);
  }
  box(g,'equipment-rubber-seam',[.588,.855,.008],[.878,.075,1.267],mat.seam,.001);
  box(g,'equipment-top-gasket',[.600,.862,.006],[.878,.075,1.510],mat.seam,.002);
  box(g,'equipment-top-cover',[.596,.858,.016],[.878,.075,1.521],mat.yellow,.004);
  box(g,'top-inspection-recess',[.316,.436,.002],[.931,.152,1.530],mat.gold,.003);
  box(g,'flush-inspection-cover',[.307,.427,.003],[.931,.152,1.532],mat.yellow,.003);
  for(const x of [.602,1.151])for(const y of [-.324,.473])cyl(g,'lid-countersunk-screw',.004,.004,.002,[x,y,1.531],mat.darkSteel,[0,0,1],8);
  for(const x of [.65,1.1])line(g,'cabinet-handle',[[x,-.13,1.528],[x,-.13,1.553],[x,.09,1.553],[x,.09,1.528]],.006,mat.black);
  const badge=group(g,'winner-brand-plate',[.925,-.358,1.41]);badge.rotation.x=Math.PI/2;
  box(badge,'brand-plate',[.20,.065,.003],[0,0,0],mat.gold,.003);
  label(badge,font,'WINNER',.025,[-.087,-.009,.003],[0,0,0],mat.red);
  box(g,'rear-access-panel',[.012,.53,.29],[1.203,.06,.77],mat.gold);
  box(g,'panel-latch',[.024,.038,.069],[1.214,.25,.78],mat.black);
  for(const y of [-.19,.30])cyl(g,'rear-panel-screw',.005,.005,.012,[1.214,y,.885],mat.steel,[1,0,0],6);
  const service=group(g,'side-utility-panel',[.90,.505,.85]);service.rotation.x=-Math.PI/2;
  box(service,'utility-enclosure',[.34,.295,.033],[0,0,0],mat.yellow,.006);
  for(let i=0;i<6;i++)box(service,'utility-vent-slot',[.089,.006,.003],[-.083,.105-i*.016,.018],mat.seam,.002);
  cyl(service,'isolator-bezel',.025,.025,.008,[.091,.095,.021],mat.black);
  box(service,'red-isolator-handle',[.012,.041,.012],[.091,.095,.030],mat.red,.003);
  for(const x of [-.079,.043]){
    cyl(service,'protected-power-socket',.025,.027,.012,[x,-.079,.025],mat.black);
    ring(service,'socket-protective-rim',.020,.002,[x,-.079,.032],mat.darkSteel,[0,0,1]);
    box(service,'hinged-socket-cap',[.045,.014,.010],[x,-.053,.034],mat.rubber,.003);
  }
  for(const x of [-.147,.147])for(const y of [-.125,.125])cyl(service,'utility-panel-screw',.004,.004,.003,[x,y,.018],mat.darkSteel,[0,0,1],8);
  const beacon=group(g,'warning-beacon',[.78,-.24,1.544]);
  cyl(beacon,'beacon-base',.052,.053,.027,[0,0,0],mat.black);
  lathe(beacon,'red-polycarbonate-dome',[[0,.006],[.047,.006],[.047,.068],[.043,.088],[.030,.101],[0,.106]],[0,0,0],mat.glass,[0,0,1]);
  for(let i=0;i<5;i++)ring(beacon,'lens-fresnel-ring',.046-i*.0002,.0016,[0,0,.02+i*.012],mat.glass,[0,0,1]);
  cyl(beacon,'reflector-core',.020,.035,.06,[0,0,.038],mat.red);
  box(g,'status-display-foot',[.079,.069,.009],[.75,.02,1.538],mat.black,.002);
  box(g,'status-display-pivot',[.035,.038,.053],[.75,.02,1.566],mat.black);
  const screen=group(g,'tilted-status-screen',[.75,.005,1.635]);screen.rotation.x=-.12;
  box(screen,'screen-frame',[.16,.058,.112],[0,0,0],mat.black,.008);
  box(screen,'display-glass',[.130,.004,.067],[0,-.031,.009],material('#17272b',.15,.3));
  box(screen,'screen-sun-hood',[.16,.037,.007],[0,-.041,.054],mat.black,.003);
  for(const x of [-.076,.076])box(screen,'screen-hood-side',[.008,.031,.045],[x,-.041,.034],mat.black,.002);
  for(const x of [-.051,.051])cyl(screen,'screen-button',.006,.006,.004,[x,-.032,-.036],mat.frame,[0,-1,0],16);
}

function chassis(parent,font) {
  const g=group(parent,'XIAOMENG-H-wheel-chassis');
  g.userData={source:'User brochure, printed pages 4-5',fidelity:'Photo-based reconstruction; hidden parts inferred',nominalEnvelopeMetres:[2.6,1.4,1.8],revision:2};
  for(const y of [-.37,.37])box(g,'longitudinal-box-frame',[2.25,.11,.13],[0,y,.275],mat.black);
  for(const x of [-.88,.79]){
    cyl(g,'axle-tube',.052,.052,1.16,[x,0,.255],mat.black,[0,1,0]);
    box(g,'axle-crossmember',[.12,.91,.085],[x,0,.33],mat.darkSteel);
  }
  for(const x of [-.87,.87])for(const y of [-.597,.597])wheel(g,x,y,font);
  profileXZ(g,'grey-structural-spine',[[-1.065,.70],[-.84,.755],[.66,.745],[.89,.63],[.76,.48],[-.31,.48],[-.64,.36],[-.93,.39],[-1.065,.53]],.48,.055,mat.frame,.013);
  for(const x of [-.725,.685])box(g,'service-hatch-end-frame',[.03,.40,.028],[x,.055,.771],mat.yellow);
  for(const y of [-.133,.243])box(g,'service-hatch-edge-frame',[1.38,.025,.028],[-.02,y,.771],mat.yellow);
  ventPanel(g,'top-service-vent',1.38,.35,36,2,[-.02,.055,.787],[0,0,0]);
  box(g,'front-lift-platform',[.55,.57,.06],[-.81,.03,.72],mat.black);
  ventPanel(g,'front-lift-grille',.48,.087,26,1,[-.80,-.243,.660]);
  for(const y of [-.15,.19]){
    cyl(g,'lift-hydraulic-barrel',.033,.033,.18,[-.89,y,.47],mat.black);
    cyl(g,'lift-hydraulic-piston',.018,.018,.105,[-.89,y,.61],mat.steel);
    line(g,'hydraulic-pressure-line',[[-.90,y,.4],[-.99,y,.46],[-.99,y,.58]],.006,mat.black);
  }
  cyl(g,'emergency-control-recess',.073,.073,.022,[-.565,-.201,.60],mat.darkSteel,[0,-1,0]);
  ring(g,'control-trim',.061,.004,[-.565,-.214,.60],mat.steel);
  cyl(g,'emergency-stop',.024,.030,.028,[-.565,-.23,.60],mat.red,[0,-1,0]);
  bolts(g,[-.565,-.218,.60],.056,4,'y',.005);
  for(const y of [-.545,.545]) {
    for(const [x,w] of [[-.31,.47],[.20,.46]]) {
      box(g,'side-compartment-rim',[w+.015,.038,.285],[x,y,.295],mat.yellow);
      box(g,'recessed-service-door',[w-.025,.011,.235],[x,y*1.045,.308],mat.gold,.004);
      box(g,'door-bottom-lip',[w,.033,.025],[x,y*1.07,.16],mat.yellow);
      for(const bx of [x-w*.37,x+w*.37]){
        cyl(g,'door-hinge',.007,.007,.033,[bx,y*1.064,.206],mat.steel,[1,0,0]);
        cyl(g,'door-fixing-screw',.0045,.0045,.012,[bx,y*1.067,.40],mat.darkSteel,[0,1,0],6);
      }
    }
    box(g,'side-door-latch',[.032,.036,.115],[-.045,y*1.07,.282],mat.black);
    cyl(g,'latch-pin',.008,.008,.044,[-.045,y*1.1,.31],mat.steel,[0,1,0]);
  }
  for(const y of [-.53,.53]){
    const lamp=group(g,'front-work-light',[-.97,y,.573]);lamp.rotation.y=-.24;
    box(lamp,'lamp-housing',[.063,.087,.076],[0,0,0],mat.black);
    box(lamp,'reflector-lens',[.006,.069,.056],[-.034,0,0],mat.white,.006);
    box(lamp,'lamp-mount',[.055,.025,.03],[.013,0,-.053],mat.darkSteel);
  }
  for(const y of [-.57,.57]){
    box(g,'jack-mount-bracket',[.135,.095,.12],[1.16,y,.40],mat.black);
    cyl(g,'stabilizer-leg',.039,.044,.30,[1.22,y,.285],mat.black);
    cyl(g,'stabilizer-chrome-ram',.024,.024,.115,[1.22,y,.084],mat.steel);
    cyl(g,'stabilizer-swivel',.035,.035,.025,[1.22,y,.037],mat.darkSteel);
    cyl(g,'stabilizer-foot',.084,.084,.024,[1.22,y,.019],mat.black,[0,0,1],48);
    line(g,'jack-pressure-hose',[[1.17,y,.43],[1.29,y,.46],[1.28,y,.24]],.005,mat.black);
  }
  line(g,'rear-protection-bar',[[1.13,-.58,.52],[1.29,-.57,.57],[1.30,.57,.57],[1.13,.58,.52]],.022);
  driverStation(g,font);cabinet(g,font);gasSupply(g,font);
  const power=group(g,'welding-power-junction');
  box(power,'auxiliary-power-box',[.24,.22,.185],[-.12,.17,.884],mat.white,.008);
  box(power,'junction-lid',[.25,.23,.012],[-.12,.17,.983],mat.white,.002);
  cyl(power,'power-box-cable-gland',.017,.017,.027,[-.06,.20,1.0005],mat.black,[0,0,1],8);
  for(const x of [-.22,-.02])for(const y of [.075,.265])cyl(power,'junction-screw',.003,.003,.003,[x,y,.991],mat.darkSteel);
  const plate=group(g,'xiaomeng-machine-plate',[.02,-.204,.687]);plate.rotation.x=Math.PI/2;
  box(plate,'brand-nameplate',[.36,.057,.003],[0,0,0],mat.yellow,.003);
  label(plate,font,'XIAOMENG H',.023,[-.152,-.009,.003],[0,0,0],mat.black);
  instanceRepeats(g);return g;
}

function weldingAccessories(arm,joints,font) {
  const spool=group(joints[1],'welding-wire-spool',[0,.330,.30]);
  cyl(spool,'spool-support-axle',.022,.022,.42,[0,-.22,0],mat.steel,[0,1,0]);
  cyl(spool,'spool-bearing-spacer',.032,.032,.295,[0,-.225,0],mat.darkSteel,[0,1,0]);
  cyl(spool,'spool-mounting-flange',.054,.054,.013,[0,-.384,0],mat.black,[0,1,0]);
  bolts(spool,[0,-.375,0],.040,4,'y',.005);
  line(spool,'wire-takeoff-bracket',[[0,-.108,0],[.01,-.108,.16],[.12,-.108,.159],[.12,-.005,.159]],.0025,mat.darkSteel);
  ring(spool,'wire-takeoff-eye',.0035,.0012,[.12,0,.159],mat.steel,[1,0,0]);
  cyl(spool,'copper-wire-pack',.157,.157,.096,[0,0,0],mat.copper,[0,1,0],64);
  for(let i=0;i<31;i++)ring(spool,'wound-wire-edge',.158,.00125,[0,-.046+i*.003,0],mat.brass);
  for(const y of [-.06,.06]) {
    lathe(spool,'stainless-spool-rim',[[.048,-.006],[.18,-.006],[.192,-.003],[.192,.003],[.18,.008],[.048,.008],[.048,-.006]],[0,y,0],mat.steel,[0,1,0]);
    cyl(spool,'black-spool-web',.173,.173,.010,[0,y*1.14,0],mat.black,[0,1,0],64);
    for(let i=0;i<24;i++){
      const a=i*Math.PI/12, yy=y*1.24;
      line(spool,'radial-spool-rib',[[Math.cos(a)*.068,yy,Math.sin(a)*.068],[Math.cos(a)*.166,yy,Math.sin(a)*.166]],.0025,mat.darkSteel);
    }
    ring(spool,'spool-reinforcing-ring',.111,.0028,[0,y*1.25,0],mat.black);
    bolts(spool,[0,y*1.30,0],.066,6,'y',.006);
  }
  cyl(spool,'spool-lock-body',.039,.041,.025,[0,.085,0],mat.gold,[0,1,0],8);
  cyl(spool,'knurled-spool-lock',.028,.029,.031,[0,.112,0],mat.black,[0,1,0],32);
  for(let i=0;i<18;i++){
    const a=i*Math.PI/9;
    cyl(spool,'knurl-tooth',.0023,.0023,.023,[Math.cos(a)*.028,.114,Math.sin(a)*.028],mat.darkSteel,[0,1,0],5);
  }
  const spoolLabel=label(spool,font,'WELDING WIRE',.010,[0,.074,.126],[-Math.PI/2,0,Math.PI],mat.white);
  if(spoolLabel){spoolLabel.geometry.computeBoundingBox();spoolLabel.position.x=spoolLabel.geometry.boundingBox.max.x/2;}
  const feeder=group(joints[2],'precision-wire-feeder',[.11,.02,.305]);
  box(feeder,'feeder-mount',[.245,.185,.018],[0,0,0],mat.black,.003);
  box(feeder,'machined-feeder-body',[.188,.128,.065],[.005,0,.043],mat.steel,.005);
  box(feeder,'feed-block-top',[.184,.132,.010],[.005,0,.082],mat.steel,.002);
  for(const x of [-.069,.069])for(const y of [-.05,.05]){
    cyl(feeder,'socket-cap-screw',.005,.005,.010,[x,y,.09],mat.darkSteel,[0,0,1],8);
    cyl(feeder,'hex-key-recess',.002,.002,.001,[x,y,.096],mat.seam,[0,0,1],6);
  }
  cyl(feeder,'motor-gearbox',.042,.042,.035,[-.065,.085,.048],mat.darkSteel,[0,1,0]);
  cyl(feeder,'feed-motor-can',.036,.036,.106,[-.065,.152,.048],mat.black,[0,1,0],48);
  ring(feeder,'motor-end-seam',.035,.002,[-.065,.198,.048],mat.steel);
  for(let i=0;i<16;i++){
    const a=i*Math.PI/8;
    cyl(feeder,'motor-cooling-fin',.0015,.0015,.08,[-.065+Math.cos(a)*.036,.15,.048+Math.sin(a)*.036],mat.darkSteel,[0,1,0],4);
  }
  const face=group(feeder,'roller-service-face',[0,-.068,.043]);face.rotation.x=Math.PI/2;
  box(face,'roller-plate',[.185,.069,.009],[0,0,0],mat.darkSteel,.004);
  for(const x of [-.047,.047]){
    cyl(face,'grooved-feed-roller',.022,.022,.014,[x,0,.009],mat.steel);
    ring(face,'wire-groove',.016,.0014,[x,0,.019],mat.black,[0,0,1]);
    cyl(face,'roller-shaft-nut',.008,.008,.013,[x,0,.024],mat.brass,[0,0,1],6);
  }
  for(const x of [-.046,.047]){
    cyl(feeder,'tension-adjuster-stem',.006,.006,.041,[x,0,.107],mat.steel);
    cyl(feeder,'black-tension-knob',.013,.013,.020,[x,0,.130],mat.black,[0,0,1],24);
  }
  for(const [x,len] of [[-.128,.055],[.131,.061]]){
    cyl(feeder,'wire-guide-connector',.014,.014,len,[x,0,.041],mat.brass,[1,0,0],6);
    cyl(feeder,'guide-ferrule',.009,.009,.024,[x+(x>0?.035:-.03),0,.041],mat.steel,[1,0,0]);
  }
  cyl(feeder,'red-cable-connector',.011,.011,.035,[-.18,0,.041],mat.black,[1,0,0]);
  label(feeder,font,'WIRE FEED',.010,[-.035,-.041,.088],[0,0,0],mat.black);
  const torch=group(joints[5],'welding-torch',[.075,0,0]);
  lathe(torch,'collision-mount-shell',[[0,0],[.039,0],[.040,.018],[.036,.025],[.036,.059],[.031,.068],[.031,.091],[0,.091]],[0,0,0],mat.black,[1,0,0]);
  ring(torch,'anti-collision-ring',.038,.003,[.019,0,0],mat.steel,[1,0,0]);
  bolts(torch,[.024,0,0],.032,6,'x',.004);
  cyl(torch,'insulated-torch-body',.030,.024,.078,[.126,0,0],mat.black,[1,0,0]);
  for(let i=0;i<8;i++)ring(torch,'insulator-rib',.028-i*.0004,.002,[.090+i*.008,0,0],mat.rubber,[1,0,0]);
  cyl(torch,'torch-neck-locknut',.020,.020,.022,[.173,0,0],mat.darkSteel,[1,0,0],12);
  ring(torch,'neck-chrome-collar',.016,.002,[.185,0,0],mat.steel,[1,0,0]);
  line(torch,'bent-steel-neck',[[.183,0,0],[.240,0,0],[.282,0,.020],[.323,0,.060]],.0105,mat.darkSteel);
  const end=V([.349,0,.083]),dir=V([.72,0,.69]).normalize();
  lathe(torch,'hollow-copper-gas-nozzle',[[.0115,-.035],[.0175,-.035],[.018,-.029],[.0165,.030],[.015,.036],[.012,.036],[.0115,-.035]],end.toArray(),mat.copper,dir.toArray());
  ring(torch,'nozzle-machining-ring',.0174,.0009,end.clone().addScaledVector(dir,-.023).toArray(),mat.brass,dir.toArray());
  cyl(torch,'recessed-gas-diffuser',.008,.008,.019,end.clone().addScaledVector(dir,.012).toArray(),mat.darkSteel,dir.toArray());
  cyl(torch,'copper-contact-tip',.004,.0048,.019,end.clone().addScaledVector(dir,.031).toArray(),mat.copper,dir.toArray());
  cyl(torch,'projecting-weld-wire',.0007,.0007,.020,end.clone().addScaledVector(dir,.049).toArray(),mat.steel,dir.toArray(),8);
  const tcp=group(torch,'weld_tcp',end.clone().addScaledVector(dir,.059).toArray());
  tcp.userData={description:'Approximate welding wire tip; attachment dimensions inferred from brochure'};
  for(const side of [-1,1]){
    const plate=group(joints[3],'forearm-brand-plate',[.71,side*.064,0]);
    plate.rotation.set(side<0?Math.PI/2:-Math.PI/2,0,side<0?0:Math.PI);
    box(plate,'black-brand-plate',[.195,.040,.002],[0,0,0],mat.black,.002);
    cyl(plate,'brand-symbol',.010,.010,.001,[.070,0,.002],mat.gold);
    label(plate,font,'XIAOMENG',.014,[-.079,-.005,.002],[0,0,0],mat.white);
  }
  instanceRepeats(spool);instanceRepeats(feeder);instanceRepeats(torch);
  return {spool,feeder,torch,tcp};
}

export { createPipePanel } from './tube-panel-model.js';

export async function createXiaomengH({loadLink,font,renderCables=true,cableShapeCacheSize=0}) {
  const root=new T.Group();root.name='XIAOMENG-H';
  root.userData={units:'metres',upAxis:'Z',source:'Brochure + FANUC official mesh; see provenance.md'};
  const base=chassis(root,font);
  const arm=group(root,'FANUC-M-10iD-8L',[-.81,.03,.765]);arm.rotation.z=Math.PI;
  root.updateMatrixWorld(true);arm.attach(base.getObjectByName('welding-power-junction'));
  arm.userData={source:'FANUC-CORPORATION/fanuc_description',sourceCommit:'fb40c9803a826ba68c7c8e28ba904a25efa7fcd2'};
  const origins=[[0,0,.45],[.075,0,0],[0,0,.84],[0,0,.195],[1.1,0,0],[0,0,0]];
  const axes=[[0,0,1],[0,1,0],[0,-1,0],[-1,0,0],[0,-1,0],[-1,0,0]];
  const loaded=await Promise.all(['base','j1','j2','j3','j4','j5','j6'].map(loadLink));
  loaded.forEach((o,index)=>o.traverse(m=>{if(m.isMesh){
    m.castShadow=m.receiveShadow=true;
    if(m.material){
      m.material=m.material.clone();const color=m.material.color;
      if(color.r>.7&&color.g>.7&&color.b<.05)color.copy(mat.yellow.color);
      else if(color.r>.65&&color.g<.15&&color.b<.15)color.set('#333638');
      else if(index===0&&color.r===color.g&&color.g===color.b&&color.r<.5)color.set('#272c2d');
      else if(index===5)color.set('#303536');
      m.material.roughness=.36;m.material.metalness=.30;
    }
  }}));
  arm.add(loaded[0]);const joints=[];let parent=arm;
  for(let i=0;i<6;i++) {
    const j=group(parent,`J${i+1}`,origins[i]);
    j.userData={axis:axes[i],limitsDeg:JOINT_LIMITS[i],originMetres:origins[i]};
    j.add(loaded[i+1]);joints.push(j);parent=j;
  }
  const accessories=weldingAccessories(arm,joints,font);
  // Verified base side face: y=.1470..1482. The compressible gasket spans
  // that 1.2 mm casting step; the metal flange sits wholly outside it.
  const basePort=group(arm,'base-dress-pack-inlet',[.040,.149,.140]);basePort.rotation.z=-Math.PI/2;
  cyl(basePort,'inlet-sealing-gasket',.044,.044,.004,[.001,0,0],mat.rubber,[1,0,0],48);
  cyl(basePort,'inlet-mounting-flange',.046,.046,.008,[-.005,0,0],mat.darkSteel,[1,0,0],48);
  bolts(basePort,[-.011,0,0],.033,4,'x',.0045);
  cyl(basePort,'dress-pack-base-coupler',.029,.031,.052,[-.033,0,0],mat.black,[1,0,0],24);
  ring(basePort,'inlet-lock-collar',.030,.003,[-.021,0,0],mat.steel,[1,0,0]);
  accessories.basePort=basePort;
  const cables=group(arm,'flexible-dress-pack');
  const localPoint=(g,p)=>arm.worldToLocal(g.localToWorld(V(p))).toArray();
  const localDirection=(g,d)=>V(localPoint(g,d)).sub(V(localPoint(g,[0,0,0]))).normalize();
  let acceptedPose=null,status={ok:false,reason:'正在建立约束'},acceptedCables=[];
  root.updateMatrixWorld(true);
  const collision=createCableCollisionModel({root,arm,links:loaded,spool:accessories.spool,feeder:accessories.feeder,torch:accessories.torch});
  // The offline planner has a fixed installation. A rigid chassis transform
  // does not change cable shapes in the arm frame. Reuse only that shape;
  // all bend, self/rigid/obstacle collisions still run for every substep.
  const cableShapes=new Map();
  function cableShapeKey(){
    // The full arm-relative installation determines the curves, not just the
    // requested angles. Include every local transform and parent on each anchor
    // path, so editing a connector, joint origin or accessory invalidates reuse.
    // Root/world transforms cancel in the arm frame; J4..J6 are not anchors.
    const frames=new Set();
    for(const anchor of [arm,accessories.feeder,basePort,accessories.spool,joints[1]]){
      let node=anchor;
      for(;node&&node!==root;node=node.parent)frames.add(node);
      if(node!==root)return null; // An externally reparented assembly is uncached.
    }
    return [...frames].map(node=>`${node.id}:${node.parent.id}:${node.matrix.elements.join(',')}`).join('|');
  }
  function candidateCables(){
    root.updateMatrixWorld(true);
    const main=fixedDressCurve(V(localPoint(accessories.feeder,[-.065,.205,.048])),localDirection(accessories.feeder,[0,1,0]),V(localPoint(basePort,[-.059,0,0])),localDirection(basePort,[1,0,0]),CABLE_LENGTHS['corrugated-main-hose'],V([0,1,-.7]).normalize());
    const red=fixedDressCurve(V(localPoint(accessories.feeder,[-.1975,0,.041])),localDirection(accessories.feeder,[-1,0,0]),V(localPoint(root,[-.06,.20,1.014])),localDirection(root,[0,0,-1]),CABLE_LENGTHS['red-supply-hose'],V([0,-1,0]),.28);
    const wire=fixedGuide([
      localPoint(accessories.spool,[0,0,.159]),localPoint(accessories.spool,[.12,0,.159]),
      localPoint(joints[1],[.16,.33,.63]),localPoint(accessories.feeder,[.28,.25,.07]),
      localPoint(accessories.feeder,[.28,.07,.041]),localPoint(accessories.feeder,[.225,0,.041]),
      localPoint(accessories.feeder,[.178,0,.041])
    ].map(V),localDirection(joints[1],[0,0,1]),CABLE_LENGTHS['wire-feed-guide']);
    return [
      {...main,name:'corrugated-main-hose',label:'主波纹管',radius:.028,renderRadius:.024,material:mat.rubber,ribbed:true},
      {...red,name:'red-supply-hose',label:'红色供给管',radius:.009,renderRadius:.009,material:mat.red},
      {...wire,name:'wire-feed-guide',label:'送丝线',radius:.0008,renderRadius:.0008,material:mat.copper},
    ];
  }
  const dummy=new T.Object3D();
  function displayCables(items){
    for(const item of items){
      let tube=cables.getObjectByName(item.name);
      if(!tube){tube=line(cables,item.name,item.curve,item.renderRadius,item.material,item.ribbed);}
      else updateTube(tube,item.curve);
      tube.userData={fixedLength:item.target,length:item.length,error:item.error};
      const ribs=cables.getObjectByName(item.name+'-corrugations');
      if(ribs){for(let i=0;i<ribs.count;i++){
        dummy.position.copy(item.curve.getPointAt(i/(ribs.count-1)));
        dummy.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),item.curve.getTangentAt(i/(ribs.count-1)));
        dummy.updateMatrix();ribs.setMatrixAt(i,dummy.matrix);
      }ribs.instanceMatrix.needsUpdate=true;ribs.computeBoundingSphere();ribs.computeBoundingBox();}
    }
  }
  function applyPose(degrees){
    degrees.forEach((q,i)=>{
      joints[i].quaternion.setFromAxisAngle(V(axes[i]),T.MathUtils.degToRad(q));joints[i].userData.angleDeg=q;
    });root.updateMatrixWorld(true);
  }
  function setPose(degrees,{endpointOnly=false}={}){
    if(!Array.isArray(degrees)||degrees.length!==6||!degrees.every(Number.isFinite))return {ok:false,reason:'关节角度无效',angles:acceptedPose};
    const requested=degrees.map((q,i)=>T.MathUtils.clamp(q,...JOINT_LIMITS[i]));
    const previous=acceptedPose?[...acceptedPose]:null;
    const steps=previous&&!endpointOnly?Math.max(1,Math.ceil(Math.max(...requested.map((q,i)=>Math.abs(q-previous[i])))/.5)):1;
    let items,result;
    for(let step=1;step<=steps;step++){
      const current=previous?requested.map((q,i)=>T.MathUtils.lerp(previous[i],q,step/steps)):requested;
      applyPose(current);
      const shapeKey=cableShapeCacheSize>0?cableShapeKey():null;
      items=shapeKey!==null?cableShapes.get(shapeKey):null;
      if(!items){
        items=candidateCables();
        if(shapeKey!==null&&items.every(c=>c.ok)){
          if(cableShapes.size>=cableShapeCacheSize)cableShapes.delete(cableShapes.keys().next().value);
          cableShapes.set(shapeKey,items);
        }
      }
      const invalid=items.find(c=>!c.ok);
      result=invalid?{ok:false,reason:`${invalid.label}：${invalid.reason||'定长误差过大'}`} :collision.validate(items);
      if(!result.ok){
        if(previous)applyPose(previous);
        status={...result,angles:previous,requested};return status;
      }
    }
    acceptedPose=requested;acceptedCables=items;if(renderCables)displayCables(items);
    status={...result,angles:[...requested],substeps:steps};return status;
  }
  function inspectPose(degrees){
    const previous=[...acceptedPose];applyPose(degrees);
    const items=candidateCables(),rigid=collision.validate([]);
    const anchors={};
    for(const [name,node,p] of [['mainStart',accessories.feeder,[-.065,.205,.048]],['mainEnd',basePort,[-.059,0,0]],['redStart',accessories.feeder,[-.1975,0,.041]],['redEnd',root,[-.06,.20,1.014]]])anchors[name]=localPoint(node,p);
    applyPose(previous);return {rigid,anchors,cables:items.map(c=>({name:c.name,ok:c.ok,reason:c.reason,length:c.length}))};
  }
  const initial=setPose(HOME_POSE);
  if(!initial.ok)throw new Error('Initial cable routing rejected: '+JSON.stringify(initial));
  return {root,base,arm,joints,accessories,setPose,inspectPose,setObstacles:collision.setObstacles,get motionStatus(){return status;},get cableState(){return acceptedCables;}};
}
