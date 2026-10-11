import {clamp,mix,makeCloud,farthestPoints,neighborhood,distance,PLAN,planRoute,alongPath,pointSegmentDistance} from '../principle-math.js';
import {C,TAU,ease,phase,blend,alpha,poly,shape,dot,ring,glow,pearl,arrow,partial,luminousPath,label,math,glassBall,glassBox} from './cloud-kit.js';

// Images in docs/design/principles are the composition/material keyframes.
// These scenes retain actual geometry: no raster crossfade stands in for FPS,
// a 3-D radius query, or a checked path around the inflated obstacles.
function resamplePipeCloud(source){
  // Densify the same synthetic surface, and use every displayed point in FPS
  // and ball queries. There are no decorative points outside the algorithm.
  const points=[];
  for(let pipe=0;pipe<2;pipe++)for(let x=0;x<36;x++)for(let k=0;k<28;k++){
    const along=x*21/35,lo=Math.floor(along),hi=Math.min(21,lo+1),around=k/2,ka=Math.floor(around),kb=(ka+1)%14,center=pipe*.71-.355;
    const radius=(xi,ki)=>Math.hypot(source[pipe*308+xi*14+ki][1]-center,source[pipe*308+xi*14+ki][2]);
    const ra=mix(radius(lo,ka),radius(lo,kb),around-ka),rb=mix(radius(hi,ka),radius(hi,kb),around-ka),r=mix(ra,rb,along-lo)+.003*Math.sin(x*19+k*11),a=k/28*TAU+.026*Math.sin(x*31+k*17+pipe);
    points.push([-1.3+x*2.6/35+(x===0||x===35?0:.018*Math.sin(x*13+k*7)),center+r*Math.cos(a),r*Math.sin(a)]);
  }return points;
}
export const CLOUD=resamplePipeCloud(makeCloud()),SAMPLES=farthestPoints(CLOUD,12,18*28),ROUTE=planRoute();
const CENTER=CLOUD[SAMPLES[0]],RADIUS=.6,MEMBERS=neighborhood(CLOUD,CENTER,RADIUS);
const CLOUD_DISTANCES=CLOUD.map(p=>distance(p,CENTER));
const REPRESENTATIVES=farthestPoints(MEMBERS.map(i=>CLOUD[i]),5,MEMBERS.indexOf(SAMPLES[0])).slice(1).map(i=>MEMBERS[i]);
const FEATURES=[[.2,.8,.4],[.9,.3,.5],[.4,.6,.7],[.5,.2,.1]],MAXIMA=[.9,.8,.7];
const CHANNELS=[C.ice,C.green,'#b69cff'];
const CLOUD_SCALE=168,FINAL_YAW=.65;

function cloudProjection(p,yaw=FINAL_YAW,scale=CLOUD_SCALE,origin=[300,217]){
  const horizontal=p[0]*Math.cos(yaw)+p[2]*Math.sin(yaw),depth=-p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw);
  return [origin[0]+horizontal*scale,origin[1]-p[1]*scale*.84+depth*scale*.54,depth*.84+p[1]*.54];
}
function cloudFloor(c,yaw=FINAL_YAW,opacity=.6){
  alpha(c,opacity,()=>{for(let i=-6;i<=6;i++){const v=i*.3;poly(c,[cloudProjection([-1.8,-.82,v],yaw).slice(0,2),cloudProjection([1.8,-.82,v],yaw).slice(0,2)],'#19426470',.55);poly(c,[cloudProjection([v,-.82,-1.2],yaw).slice(0,2),cloudProjection([v,-.82,1.2],yaw).slice(0,2)],'#19426470',.55);}});
}
function cloudPoints(c,{yaw=FINAL_YAW,radius=0,samples=0,neighborhoodOnly=false,opacity=1,origin=[300,217],scale=CLOUD_SCALE,transform=null}={}){
  const cloud=CLOUD.map((p,i)=>({i,p:cloudProjection(p,yaw,scale,origin)})).sort((a,b)=>b.p[2]-a.p[2]);
  for(const {i,p} of cloud){const d=CLOUD_DISTANCES[i],inside=radius>0?ease((radius-d)/.045):0;
    if(neighborhoodOnly&&d>RADIUS)continue;
    const depth=clamp((p[2]+.85)/1.8),pipeCenter=i<1008?-.355:.355,front=clamp(.5-(.84*CLOUD[i][2]*Math.cos(yaw)+.54*(CLOUD[i][1]-pipeCenter))/.66),q=transform?transform(p,i):p,r=mix(1.05,2.6,front)*(1-depth*.13),sampleIndex=SAMPLES.indexOf(i),sample=sampleIndex>=0?phase(samples,sampleIndex,sampleIndex+.72):0;
    alpha(c,opacity*mix(mix(.18,.98,front),.98,inside),()=>{pearl(c,q,r,C.ice);if(inside>0)alpha(c,inside,()=>pearl(c,q,r,C.orange));});
    if(sample>0)alpha(c,opacity*sample,()=>pearl(c,q,4.8,C.orange,true));
  }
}
function groupScene(c,t,opacity=1){
  // Each spoken beat has a distinct geometric event: locate center, grow the
  // ball, then sweep its actual boundary to explain spatial membership.
  const radius=RADIUS*phase(t,.08,.78),cp=cloudProjection(CENTER).slice(0,2),r=radius*CLOUD_SCALE;
  cloudFloor(c);
  alpha(c,opacity,()=>{
    cloudPoints(c,{radius,opacity:.75});
    if(r>.1){glassBall(c,cp,r,.86);const angle=mix(-.92,-.42,phase(t,.69,1));
      const tip=[cp[0]+r*Math.cos(angle),cp[1]+r*Math.sin(angle)];poly(c,[cp,tip],C.white+'b3',1,[3,4]);pearl(c,tip,2.4,C.white);
    }
    pearl(c,cp,6,C.orange,true);
  });return {cp,r};
}

function drawFeatureScene(c,t,annotationOpacity){
  const morph=phase(t,0,.23),focus=[90,199],sourceCenter=cloudProjection(CENTER),pointScale=mix(1,.55,morph),hierarchy=phase(t,.7,.86);
  cloudFloor(c,FINAL_YAW,mix(.6,.22,morph));
  c.save();c.globalAlpha*=1-hierarchy;
  // The complete previous neighborhood translates and shrinks continuously.
  alpha(c,1-phase(t,.04,.23),()=>cloudPoints(c,{radius:RADIUS,opacity:.52}));
  const movingCenter=blend(sourceCenter,focus,morph);
  cloudPoints(c,{neighborhoodOnly:true,radius:RADIUS,transform:p=>[movingCenter[0]+(p[0]-sourceCenter[0])*pointScale,movingCenter[1]+(p[1]-sourceCenter[1])*pointScale],opacity:.96});
  glassBall(c,movingCenter,RADIUS*CLOUD_SCALE*pointScale,.8);pearl(c,movingCenter,6,C.orange,true);
  const network=phase(t,.09,.23),layers=[[211,[130,172,214,256]],[265,[110,152,194,236,278]],[319,[130,172,214,256]]];
  alpha(c,network,()=>{
    for(let layer=0;layer<2;layer++)for(const ya of layers[layer][1])for(const yb of layers[layer+1][1])poly(c,[[layers[layer][0],ya],[layers[layer+1][0],yb]],'#83bae52d',.65);
    layers.forEach(([x,ys])=>ys.forEach(y=>pearl(c,[x,y],7.8,'#a5cde9')));
    arrow(c,[153,194],[191,194],C.ice,1.1);
  });
  // Four actual neighborhood representatives pass through the same network.
  // Activation rows are a schematic, not a trained PointNet++ inference.
  for(let row=0;row<4;row++){
    const travel=phase(t,.16+row*.027,.29+row*.036),id=REPRESENTATIVES[row],p=cloudProjection(CLOUD[id]);
    const local=[focus[0]+(p[0]-sourceCenter[0])*.55,focus[1]+(p[1]-sourceCenter[1])*.55];
    const trace=[local,[183,194],[211,layers[0][1][row]],[265,layers[1][1][row]],[319,layers[2][1][row]],[352,194]];
    if(travel>0&&travel<1){const dotPath=partial(trace,travel);alpha(c,Math.sin(Math.PI*travel)*.8,()=>{poly(c,dotPath,C.ice,1.2);pearl(c,dotPath.at(-1),4.2,C.white,true);});}
  }
  const panels=phase(t,.24,.34);
  alpha(c,panels,()=>{
    CHANNELS.forEach((color,ch)=>{
      const x=382,y=87+ch*76;glassBox(c,x,y,148,54,color);
      // One rod per point; comparing length inside each channel makes
      // per-channel pooling explicit without a dense numerical table.
      FEATURES.forEach((features,row)=>{
        const grow=phase(t,.26+row*.018,.36+row*.024),max=features[ch]===MAXIMA[ch],take=phase(t,.38+ch*.03,.49+ch*.03);
        const yy=y+10+row*10,len=features[ch]*104*grow;
        alpha(c,max?1:1-take*.48,()=>{poly(c,[[x+13,yy],[x+13+len,yy]],color,2.5);if(grow>0)pearl(c,[x+13+len,yy],2.8,color);if(max)alpha(c,take,()=>{poly(c,[[x+13,yy],[x+13+len,yy]],C.orange,2.5);pearl(c,[x+13+len,yy],2.8,C.orange);});});
      });
      arrow(c,[341,194],[370,y+27],color,.85);
    });
  });
  const pool=phase(t,.46,.66);
  alpha(c,pool,()=>{
    glassBox(c,241,340,142,43,C.orange);
    CHANNELS.forEach((color,ch)=>{
      const origin=[532,114+ch*76],target=[267+ch*44,361],p=phase(t,.46+ch*.028,.60+ch*.028);
      const curve=[];for(let k=0;k<=32;k++){const s=k/32,u=1-s;curve.push([u*u*u*origin[0]+3*u*u*s*565+3*u*s*s*(422-ch*18)+s*s*s*target[0],u*u*u*origin[1]+3*u*u*s*(325+ch*8)+3*u*s*s*318+s*s*s*target[1]]);}
      alpha(c,.5,()=>poly(c,partial(curve,p),C.orange,1));if(p>0&&p<1)pearl(c,partial(curve,p).at(-1),3.5,C.orange,true);
      alpha(c,p,()=>pearl(c,target,5+MAXIMA[ch]*4,C.orange,true));
    });
  });
  const text=annotationOpacity*phase(t,.09,.20);
  math(c,'p','i',55,285,{opacity:text,color:C.ice,size:22});label(c,'−',81,279,{opacity:text,color:C.white,size:19});math(c,'c','',94,285,{opacity:text,color:C.orange,size:22});
  label(c,'共享 MLP',265,308,{opacity:text,color:C.white,size:18});label(c,'逐通道最大值',470,383,{opacity:annotationOpacity*pool,color:C.orange,size:17});
  c.restore();
  // Beat three visibly moves from point features to a larger neighborhood.
  // Each small vector is a different local feature, not another raw point.
  alpha(c,hierarchy,()=>{
    const middle=[300,188],local=[[146,277],[300,333],[454,277]],gather=phase(t,.8,1);
    glassBall(c,middle,mix(35,111,gather),.75);
    local.forEach((p,i)=>{
      glassBox(c,p[0]-43,p[1]-17,86,34,i===1?C.orange:C.ice);
      for(let ch=0;ch<3;ch++)pearl(c,[p[0]-25+ch*25,p[1]],3+((i+ch)%3),i===1?C.orange:C.ice);
      const end=[middle[0]+(i-1)*34,middle[1]+9];luminousPath(c,[p,end],gather,i===1?C.orange:C.ice,1);
      alpha(c,gather,()=>pearl(c,end,5.7,i===1?C.orange:C.ice,true));
      math(c,'h',String(i+1),p[0]-7,p[1]+42,{opacity:annotationOpacity,color:i===1?C.orange:C.ice,size:22});
    });
    label(c,'更大范围的邻域',300,50,{opacity:annotationOpacity,color:C.white,size:19});
  });
}

export function drawPointnet(c,step,progress,{annotationOpacity=1}={}){
  const t=clamp(progress);step=clamp(Math.floor(step),0,3);c.save();
  if(step===3)drawFeatureScene(c,t,annotationOpacity);
  else if(step===2){const {cp,r}=groupScene(c,t);math(c,'c','',cp[0]+11,cp[1]+27,{opacity:annotationOpacity,color:C.orange});if(r>24){const a=mix(-.92,-.42,phase(t,.69,1));math(c,'r','',cp[0]+r*.69*Math.cos(a)+6,cp[1]+r*.69*Math.sin(a)-6,{opacity:annotationOpacity*phase(t,.17,.35),color:C.white});}}
  else{
    const yaw=step===0?mix(.3,FINAL_YAW,phase(t,0,1)):FINAL_YAW;cloudFloor(c,yaw);
    if(step===0){cloudPoints(c,{yaw});
      // The final beat draws a few real radial samples while the same camera
      // completes its move; geometric structure stays understandable.
      const cross=phase(t,.12,.91);alpha(c,(.12+cross*.22),()=>{for(const pipe of [0,1])for(const row of [0,35]){const pts=Array.from({length:29},(_,k)=>cloudProjection(CLOUD[pipe*1008+row*28+k%28],yaw).slice(0,2));poly(c,pts,C.ice,.8);}});
    }else{
      const clock=mix(.0,11.72,t);cloudPoints(c,{samples:clock});
      const k=Math.min(11,Math.max(1,Math.floor(clock))),age=clock-k;
      const newest=CLOUD[SAMPLES[k]],nearest=SAMPLES.slice(0,k).reduce((best,i)=>distance(CLOUD[i],newest)<distance(CLOUD[best],newest)?i:best,SAMPLES[0]);
      const a=cloudProjection(CLOUD[nearest]).slice(0,2),b=cloudProjection(newest).slice(0,2),visibility=Math.sin(Math.PI*clamp(age));
      alpha(c,visibility*.65,()=>{poly(c,[a,blend(a,b,phase(age,0,.65))],C.orange,1,[3,4]);ring(c,b,10,C.orange,1);});
      label(c,`${Math.min(12,Math.max(1,Math.ceil(clock)))} / 12`,300,387,{opacity:annotationOpacity,color:C.orange,size:19});
    }
  }c.restore();
}

const planProject=([x,y],h=0)=>[300+(x-5)*43-(y-4)*13,262-(x-5)*9-(y-4)*22-h];
const ringPoints=(center,r,h=0,count=72)=>Array.from({length:count+1},(_,i)=>planProject([center[0]+r*Math.cos(i/count*TAU),center[1]+r*Math.sin(i/count*TAU)],h));
function planningFloor(c){
  const border=[[0,0],[10,0],[10,8],[0,8]].map(p=>planProject(p));
  for(const [a,b] of [[border[0],border[1]],[border[3],border[0]]])shape(c,[a,b,[b[0],b[1]+5],[a[0],a[1]+5]],'#17436540','#77c7fd35',.6);
  const light=c.createRadialGradient(300,262,12,300,262,300);light.addColorStop(0,'#32628f66');light.addColorStop(1,'#1437542d');shape(c,border,light,'#6bacd794',.8);
  for(let x=0;x<=10;x+=.5)poly(c,[planProject([x,0]),planProject([x,8])],x%1===0?'#5483ad69':'#315a7933',.6);
  for(let y=0;y<=8;y+=.5)poly(c,[planProject([0,y]),planProject([10,y])],y%1===0?'#5483ad69':'#315a7933',.6);
}
function cylinder(c,center,r,height,{glass=false,tint=C.orange,alpha:opacity=1}={}){
  const bottom=ringPoints(center,r),top=ringPoints(center,r,height),origin=planProject(center);
  alpha(c,opacity,()=>{
    if(!glass){c.save();c.shadowColor='#000b';c.shadowBlur=17;c.shadowOffsetY=5;shape(c,bottom,'#0007');c.restore();}
    // One uninterrupted side silhouette avoids antialiased seams between
    // facets. Its circular footprint and depth ordering remain geometric.
    const facing=Math.atan2(-22,-9),sideBottom=[],sideTop=[];
    for(let i=0;i<=72;i++){const a=facing-Math.PI/2+i/72*Math.PI,p=[center[0]+r*Math.cos(a),center[1]+r*Math.sin(a)];sideBottom.push(planProject(p));sideTop.push(planProject(p,height));}
    const metal=c.createLinearGradient(origin[0]-r*43,0,origin[0]+r*43,0);
    if(glass){metal.addColorStop(0,tint+'43');metal.addColorStop(.5,tint+'0b');metal.addColorStop(1,tint+'37');}
    else{metal.addColorStop(0,'#263953');metal.addColorStop(.19,'#627f9e');metal.addColorStop(.28,'#354b66');metal.addColorStop(.7,'#071423');metal.addColorStop(1,'#263b53');}
    shape(c,[...sideBottom,...sideTop.toReversed()],metal);
    const g=c.createLinearGradient(origin[0]-r*43,origin[1]-height-r*22,origin[0]+r*43,origin[1]-height+r*22);
    if(glass){g.addColorStop(0,tint+'30');g.addColorStop(.6,tint+'09');g.addColorStop(1,tint+'23');}
    else{g.addColorStop(0,'#697e98');g.addColorStop(.28,'#455a73');g.addColorStop(1,'#1e3049');}
    shape(c,top,g,glass?tint+'d5':'#a6c7e4b0',glass?.95:.95);
    poly(c,glass?bottom:sideBottom,glass?tint+'cf':'#6b93b488',.75,glass?[3,4]:[]);
    if(glass){for(const i of [6,42])poly(c,[bottom[i],top[i]],tint+'70',.7,[2,3]);}
  });
}
function planningDisk(c,pos,{halo=false}={}){
  if(halo){alpha(c,.055,()=>shape(c,ringPoints(pos,PLAN.body+PLAN.margin),'#92eaff'));poly(c,ringPoints(pos,PLAN.body+PLAN.margin),'#8ad3f15c',.8);}
  cylinder(c,pos,PLAN.body,7,{tint:C.ice});const p=planProject(pos,7);glow(c,p,19,C.ice,.2);pearl(c,p,5.8,C.ice,true);
}
function planMarker(c,p,color,r=10){const screen=planProject(p,1);glow(c,screen,24,color,.15);poly(c,ringPoints(p,r/43,1),color+'bc',1.1);pearl(c,screen,4.3,color,true);}

export function drawPlanning(c,step,progress,{annotationOpacity=1}={}){
  const t=clamp(progress);step=clamp(Math.floor(step),0,3);c.save();planningFloor(c);
  const start=PLAN.start,goal=PLAN.goal,first=PLAN.obstacles[0],stop=[first.c[0]-first.r-PLAN.body,start[1]],route=ROUTE.simplified;
  if(step<2)poly(c,[planProject(start,1),planProject(goal,1)],'#d7848173',1.1,[5,6]);
  if(step>=2){const reveal=step===2?mix(0,ROUTE.visited.length,phase(t,0,.77)):ROUTE.visited.length;
    ROUTE.visited.forEach((p,i)=>{const a=phase(reveal,i,i+7);if(a)alpha(c,a*(step===3?.25:.67),()=>pearl(c,planProject(p,1),1.5,C.ice));});
    if(step===2)luminousPath(c,ROUTE.path.map(p=>planProject(p,2)),phase(t,.64,1),C.ice,2.2);
    else{alpha(c,1-phase(t,0,.3),()=>poly(c,ROUTE.path.map(p=>planProject(p,2)),C.ice,.8,[3,3]));luminousPath(c,route.map(p=>planProject(p,2)),phase(t,0,.24),C.ice,2.4);}
  }
  const growth=step===1?PLAN.body*phase(t,0,.42)+PLAN.margin*phase(t,.34,.79):PLAN.body+PLAN.margin;
  let pos=start;
  if(step===0)pos=alongPath([start,stop],phase(t,0,.30));
  if(step===3){const travel=clamp((t-.17)/.83);pos=travel<.43?alongPath(route.slice(0,2),phase(travel,0,.43)):alongPath(route.slice(1),phase(travel,.43,1));}
  // Painter order puts the moving disk behind or before the obstacle based
  // on depth. It cannot appear as a floating dot drawn through the solid.
  const objects=PLAN.obstacles.map((o,index)=>({kind:'obstacle',o,index,depth:planProject(o.c)[1]}));objects.push({kind:'disk',depth:planProject(pos)[1]});objects.sort((a,b)=>a.depth-b.depth);
  objects.forEach(object=>{if(object.kind==='disk')planningDisk(c,pos,{halo:step===3});else{const {o}=object;if(step>=1)cylinder(c,o.c,o.r+growth,57,{glass:true,alpha:.95});cylinder(c,o.c,o.r,50);}});
  planMarker(c,start,C.ice,8);planMarker(c,goal,C.orange,11);
  const s=planProject(start),g=planProject(goal);label(c,'起点',s[0]-9,s[1]+31,{opacity:annotationOpacity,color:C.ice,size:17});label(c,'目标',g[0]+9,g[1]-23,{opacity:annotationOpacity,color:C.orange,size:17});
  if(step===0){
    const contact=planProject([first.c[0]-first.r,start[1]],5),a=phase(t,.29,.34);
    alpha(c,a,()=>{glow(c,contact,17,C.red,.22);ring(c,contact,5,C.red,1.2);});
    // The last narration beat measures the actual center distance at contact.
    const p=planProject(stop,76),o=planProject(first.c,76),reveal=phase(t,.34,.66);
    alpha(c,phase(t,.33,.44),()=>{poly(c,[planProject(stop,8),p],'#9ebace66',.75,[3,4]);poly(c,[planProject(first.c,50),o],'#9ebace66',.75,[3,4]);poly(c,partial([p,o],reveal),C.red,1.2);math(c,'d','',mix(p[0],o[0],.5),mix(p[1],o[1],.5)-13,{opacity:annotationOpacity,color:C.red,size:24});});
    const scan=phase(t,.67,1),lineStart=planProject(start,78),lineGoal=planProject(goal,78);
    alpha(c,phase(t,.67,.77)*.65,()=>{poly(c,partial([lineStart,lineGoal],scan),C.red,1.1,[4,5]);const probe=blend(lineStart,lineGoal,scan);pearl(c,probe,3,C.red);});
  }else if(step===1){
    const a=first.c,b=[first.c[0]-first.r-growth,first.c[1]],pa=planProject(a,69),pb=planProject(b,69);
    alpha(c,phase(t,.08,.3),()=>{arrow(c,pa,pb,C.orange,1.1);math(c,'R','',mix(pa[0],pb[0],.5)-3,mix(pa[1],pb[1],.5)-12,{opacity:annotationOpacity,color:C.orange,size:24});});
    // A small arc sweep traverses the completed boundary while explaining
    // clearance. It is the same forbidden boundary, not decorative motion.
    const sweep=phase(t,.72,1);if(sweep>0){const ring=ringPoints(first.c,first.r+growth,57);alpha(c,.6,()=>poly(c,partial(ring,sweep),C.orange,1.3));}
  }else if(step===2){
    // The middle spoken beat decomposes one real candidate's score. g uses
    // the known clear grid path; dashed h is a distance estimate, not a path.
    const index=13,candidate=ROUTE.path[index],fromStart=ROUTE.path.slice(0,index+1).map(p=>planProject(p,5)),at=planProject(candidate,5),toGoal=planProject(goal,5),show=phase(t,.34,.43)*(1-phase(t,.67,.76));
    alpha(c,show,()=>{
      luminousPath(c,fromStart,phase(t,.34,.53),C.orange,2);pearl(c,at,4.2,C.orange,true);
      // Lift the distance construction above all solid obstacles. Both ends
      // retain the exact candidate/goal XY coordinates; dotted projections
      // distinguish this estimate from the executable ground-plane route.
      const raisedStart=planProject(candidate,155),raisedGoal=planProject(goal,155),estimate=phase(t,.44,.63),mid=blend(raisedStart,raisedGoal,.5);
      alpha(c,phase(t,.42,.49),()=>{
        poly(c,[at,raisedStart],'#bfd7e766',.8,[2,5]);poly(c,[toGoal,raisedGoal],'#bfd7e766',.8,[2,5]);
        poly(c,[raisedStart,blend(raisedStart,raisedGoal,estimate)],C.white+'e6',1.4,[4,5]);
        ring(c,raisedStart,3,C.orange,1);ring(c,raisedGoal,3,C.white,1);
        math(c,'h','',mid[0]-6,mid[1]-13,{opacity:annotationOpacity,color:C.white,size:24});
      });
      math(c,'g','',at[0]-45,at[1]+34,{opacity:annotationOpacity,color:C.orange,size:24});
    });
  }else if(step===3){
    const nearest=PLAN.obstacles.reduce((best,o)=>distance(pos,o.c)-o.r<distance(pos,best.c)-best.r?o:best,first),d=distance(pos,nearest.c),toward=pos.map((v,i)=>(nearest.c[i]-v)/(d||1));
    const from=pos.map((v,i)=>v+toward[i]*PLAN.body),to=nearest.c.map((v,i)=>v-toward[i]*nearest.r);
    alpha(c,phase(t,.28,.43)*.75,()=>poly(c,[planProject(from,4),planProject(to,4)],C.green,.8,[3,4]));
    // The minimum surface gap is derived from the checked segments, not from
    // a sampled animation frame or a prettier unverified spline.
    const minimum=Math.min(...route.slice(1).flatMap((p,i)=>PLAN.obstacles.map(o=>pointSegmentDistance(o.c,route[i],p)-o.r-PLAN.body)));
    label(c,`最小间隙 ${minimum.toFixed(2)} m`,300,398,{opacity:annotationOpacity*phase(t,.72,.95),color:C.green,size:17});
  }c.restore();
}
