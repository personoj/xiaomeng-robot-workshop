import {fk,ik,ikIterations,rotate2} from '../principle-math.js';
import {ICE,AMBER,WHITE,TAU,sat,ease,lerp,lerpV,beat,project,rgba,path,glow,pearl,stroke,arrow,tube,joint,label,glassPlane,triad,pulseAlong,curvedArrow,partialPath} from './spatial-kit.js';

// Each chapter has three semantic beats. The narration clock maps the actual
// three recorded utterance durations to these thirds, so a reveal never runs
// ahead simply because a speaker takes longer to pronounce a sentence.
export const SPATIAL_BEATS = {
  coordinates: [['world reference','camera reference','same physical point'],['shared origin','rotate, do not stretch','equivalent direction'],['origin offset','head-to-tail addition','world resultant'],['camera to world','world to base','compose in that order']],
  inverse_kinematics: [['first joint','relative second joint','endpoint follows both'],['target fixed','position difference','joint correction needed'],['local direction','repeat small corrections','converged endpoint'],['alternate elbow solution','reveal reachable annulus','same target, two solutions']],
};

const W=[-1.18,.52,0], C=[1.12,-.40,0], TARGET=[.23,-.11,2.4];
const wp=project(W), cp=project(C), pp=project(TARGET), foot=project([TARGET[0],TARGET[1],0]);
const plus=(a,b)=>a.map((x,i)=>x+b[i]);
const minus=(a,b)=>a.map((x,i)=>x-b[i]);
const readAlpha=options=>options.annotationOpacity??1;

function spatialAtmosphere(ctx){
  glow(ctx,[305,277],225,'#286a9c',.105);
  const g=ctx.createRadialGradient(300,367,8,300,367,214);g.addColorStop(0,'rgba(3,10,19,.4)');g.addColorStop(1,'rgba(3,10,19,0)');ctx.fillStyle=g;ctx.save();ctx.translate(0,234);ctx.scale(1,.35);ctx.beginPath();ctx.ellipse(300,367,242,109,0,0,TAU);ctx.fill();ctx.restore();
}
function targetPoint(ctx,{point=pp,drop=foot,alpha=1}={}){stroke(ctx,point,drop,WHITE,1,.36*alpha,[3.2,4.2]);pearl(ctx,drop,2.8,ICE,alpha*.8);pearl(ctx,point,8, '#ffe1b9',alpha);}
function coordinateLabels(ctx,opacity,{world=wp,camera=cp,point=pp,showWorld=true,showCamera=true,showPoint=true}={}){
  if(showWorld)label(ctx,'O','W',world[0]-8,world[1]+31,{color:ICE,alpha:opacity,superIndex:true});
  if(showCamera)label(ctx,'O','C',camera[0]+15,camera[1]+34,{color:AMBER,alpha:opacity,superIndex:true});
  if(showPoint)label(ctx,'p','',point[0]+18,point[1]-4,{color:WHITE,alpha:opacity,size:23});
}

export function drawCoordinates(ctx, step, progress, options={}){
  const p=sat(progress),a=readAlpha(options),b0=beat(p,0),b1=beat(p,1),b2=beat(p,2);
  ctx.save();spatialAtmosphere(ctx);glassPlane(ctx);
  if(step===0){
    targetPoint(ctx);triad(ctx,W,{progress:.4+.6*b0});triad(ctx,C,{angle:-.68,color:AMBER,alpha:.3+.7*b1,progress:.35+.65*b1});
    arrow(ctx,wp,lerpV(wp,pp,.1+.9*b0),ICE,{dash:[4,4],alpha:.84,width:1.2});
    arrow(ctx,cp,lerpV(cp,pp,b1),AMBER,{dash:[4,4],alpha:.84,width:1.2});
    pulseAlong(ctx,wp,pp,b2,ICE,3);pulseAlong(ctx,cp,pp,b2,AMBER,3);
    coordinateLabels(ctx,a);
    // Labels sit beside their vector, never on top of the luminous geometry.
    label(ctx,'p','W',202,185,{color:ICE,alpha:a*b0,size:20});label(ctx,'p','C',387,181,{color:AMBER,alpha:a*b1,size:20});
  } else if(step===1){
    const origin=[-.14,.18,0],o=project(origin),v=[1.24,-.56,1.72],angle=.92*b1;
    const turned=rotate2(v,angle),end=project(plus(origin,[...turned,v[2]])),start=project(plus(origin,v));
    triad(ctx,origin,{scale:1.03,progress:.5+.5*b0});
    arrow(ctx,o,start,ICE,{alpha:.36*b0,width:1.35,dash:[4,5]});
    const arc=[];for(let i=0;i<=55;i++){const xy=rotate2([v[0]*.56,v[1]*.56],.92*i/55);arc.push(project(plus(origin,[xy[0],xy[1],v[2]*.56])));}
    ctx.save();ctx.globalAlpha=.09+.1*b0;path(ctx,[o,...arc],true);ctx.fillStyle=ICE;ctx.fill();ctx.restore();
    const partial=partialPath(arc,b1);curvedArrow(ctx,partial,AMBER,.7,1.5);
    arrow(ctx,o,end,AMBER,{glowing:true,width:2.1,alpha:.25+.75*b0});pearl(ctx,end,7,'#ffdeb7',.25+.75*b0);
    pearl(ctx,start,4,ICE,.48*b0);pulseAlong(ctx,o,end,b2,AMBER,2.5);
    label(ctx,'O','',o[0]-11,o[1]+29,{color:ICE,alpha:a});label(ctx,'p','C',start[0]+11,start[1]-14,{color:ICE,alpha:a*b0});label(ctx,'Rp','C',end[0]-12,end[1]-20,{color:AMBER,alpha:a*b1});
  } else if(step===2){
    triad(ctx,W);triad(ctx,C,{angle:-.68,color:AMBER,alpha:.7});
    const delta=minus(TARGET,C),movingOrigin=lerpV(W,C,b1),movingEnd=plus(movingOrigin,delta),v0=project(movingOrigin),v1=project(movingEnd);
    arrow(ctx,wp,lerpV(wp,cp,b0),AMBER,{glowing:true,width:2.1});
    arrow(ctx,v0,v1,ICE,{glowing:true,width:2});pearl(ctx,v1,6,ICE,1-.7*b1);
    arrow(ctx,wp,pp,WHITE,{alpha:b2*.6,width:1.1,dash:[4,5]});targetPoint(ctx,{alpha:.5+.5*b1});
    pulseAlong(ctx,wp,cp,b2,AMBER,2.6);pulseAlong(ctx,cp,pp,b2,ICE,2.6);
    coordinateLabels(ctx,a);
    label(ctx,'t','WC',276,315,{color:AMBER,alpha:a*b0});label(ctx,'Rp','C',v1[0]+19,v1[1]+27,{color:ICE,alpha:a,size:19});
  } else {
    const base=[-.78,-1.20,0],bp=project(base),origins=[C,W,base],positions=[cp,wp,bp];
    triad(ctx,W,{scale:.85});triad(ctx,C,{angle:-.68,scale:.85,color:AMBER});triad(ctx,base,{angle:.34,scale:.85,color:'#8eefe4',alpha:.4+.6*b1});
    const curves=[];for(let edge=0;edge<2;edge++){
      const from=positions[edge],to=positions[edge+1],pts=[];for(let i=0;i<=50;i++){const t=i/50;pts.push([lerp(from[0],to[0],t),lerp(from[1],to[1],t)-52*Math.sin(Math.PI*t)]);}curves.push(pts);
      const phase=edge===0?b0:b1;curvedArrow(ctx,partialPath(pts,phase),edge===0?AMBER:ICE,.8,1.9);
    }
    targetPoint(ctx);for(let i=0;i<3;i++){stroke(ctx,positions[i],pp,i===0?AMBER:i===1?ICE:'#8eefe4',.9,.15+.2*b2,[3,5]);}
    const follow=b2*2,index=Math.min(1,Math.floor(follow)),f=follow-index,curve=curves[index];if(b2>0&&b2<1)pearl(ctx,partialPath(curve,f).at(-1),3.5,WHITE);
    coordinateLabels(ctx,a);label(ctx,'O','B',bp[0]+12,bp[1]-2,{color:'#8eefe4',alpha:a,superIndex:true});
    label(ctx,'T','WC',300,250,{color:AMBER,alpha:a*b0,size:19});label(ctx,'T','BW',175,229,{color:ICE,alpha:a*b1,size:19});
  }
  ctx.restore();
}

const INITIAL=[.88,-.55], FORWARD_START=[.32,-.28], TARGET_2=[1.70,.68];
const SOLUTION=ik(TARGET_2,[1.1,.85],-1),OTHER_SOLUTION=ik(TARGET_2,[1.1,.85],1);
const ITERATIONS=ikIterations(TARGET_2,INITIAL,28);
const ITERATION_ARC=[0];
for(let i=1;i<ITERATIONS.length;i++)ITERATION_ARC.push(ITERATION_ARC.at(-1)+Math.hypot(...ITERATIONS[i].q.map((q,k)=>q-ITERATIONS[i-1].q[k])));
function armProjection(point,layout){return [layout.x+point[0]*layout.scale,layout.y-point[1]*layout.scale];}
function armPoints(q,layout){const p=fk(q);return [[layout.x,layout.y],armProjection(p.elbow,layout),armProjection(p.tip,layout)];}

function pedestal(ctx,layout,opacity=1){
  const {x,y,scale}=layout,k=scale/137,w=43*k,h=15*k;
  ctx.save();ctx.globalAlpha*=opacity;
  glow(ctx,[x,y+53*k],75*k,ICE,.09);
  const contact=ctx.createRadialGradient(x,y+57*k,3*k,x,y+57*k,70*k);contact.addColorStop(0,'rgba(1,7,14,.63)');contact.addColorStop(1,'rgba(1,7,14,0)');ctx.save();ctx.translate(x,y+59*k);ctx.scale(1,.22);ctx.fillStyle=contact;ctx.translate(-x,-y-57*k);ctx.beginPath();ctx.arc(x,y+57*k,70*k,0,TAU);ctx.fill();ctx.restore();
  const metal=ctx.createLinearGradient(x-w,y,x+w,y);metal.addColorStop(0,'#0b1520');metal.addColorStop(.18,'#66717f');metal.addColorStop(.35,'#202c3c');metal.addColorStop(.74,'#0a1522');metal.addColorStop(.92,'#465262');metal.addColorStop(1,'#101d2c');
  ctx.fillStyle=metal;ctx.beginPath();ctx.roundRect(x-w,y+39*k,w*2,h,2);ctx.fill();ctx.beginPath();ctx.ellipse(x,y+53*k,w,9*k,0,0,Math.PI);ctx.fill();
  ctx.fillStyle='#263649';ctx.strokeStyle='rgba(190,214,237,.45)';ctx.lineWidth=.8;ctx.beginPath();ctx.ellipse(x,y+39*k,w,10*k,0,0,TAU);ctx.fill();ctx.stroke();
  const cone=ctx.createLinearGradient(x-24*k,y,x+23*k,y);cone.addColorStop(0,'#788696');cone.addColorStop(.26,'#f5f8ff');cone.addColorStop(.53,'#c4cfdf');cone.addColorStop(.75,'#b4bfce');cone.addColorStop(1,'#495969');
  path(ctx,[[x-13*k,y-2*k],[x+13*k,y-2*k],[x+27*k,y+35*k],[x+24*k,y+40*k],[x-25*k,y+40*k],[x-28*k,y+35*k]],true);ctx.fillStyle=cone;ctx.fill();ctx.strokeStyle='#d4e3f1';ctx.lineWidth=.8;ctx.stroke();
  ctx.strokeStyle='#192435';ctx.lineWidth=2*k;ctx.beginPath();ctx.ellipse(x,y+39*k,26*k,5*k,0,0,Math.PI);ctx.stroke();ctx.restore();
}
function robotArm(ctx,q,layout,{ghost=false,alpha=1,base=true,baseOpacity=1}={}){
  const [o,e,t]=armPoints(q,layout),k=layout.scale/137;
  if(base)pedestal(ctx,layout,alpha*baseOpacity);
  tube(ctx,o,e,32*k,{ghost,alpha});tube(ctx,e,t,25*k,{ghost,alpha});
  joint(ctx,o,19*k,{ghost,alpha});joint(ctx,e,16*k,{ghost,alpha});joint(ctx,t,8*k,{ghost,alpha});
  pearl(ctx,t,5.3*k,ghost?ICE:WHITE,alpha);return [o,e,t];
}
function angleArc(ctx,center,start,end,r,alpha){
  const pts=[];for(let i=0;i<=40;i++){const angle=lerp(start,end,i/40);pts.push([center[0]+r*Math.cos(angle),center[1]-r*Math.sin(angle)]);}
  ctx.save();ctx.globalAlpha=.1*alpha;path(ctx,[center,...pts],true);ctx.fillStyle=AMBER;ctx.fill();ctx.restore();curvedArrow(ctx,pts,AMBER,alpha,1.4);
}
function targetMarker(ctx,p,alpha=1,focus=1){
  ctx.save();ctx.globalAlpha*=alpha;glow(ctx,p,32,AMBER,.3);ctx.strokeStyle=rgba(AMBER,.75);ctx.lineWidth=1;ctx.beginPath();ctx.arc(...p,13+18*(1-focus),0,TAU);ctx.stroke();pearl(ctx,p,5.8,AMBER);ctx.restore();
}
function workspace(ctx,layout,alpha){
  const outer=1.95*layout.scale,inner=.25*layout.scale,{x,y}=layout;
  ctx.save();ctx.globalAlpha*=alpha;
  const g=ctx.createRadialGradient(x,y,inner,x,y,outer);g.addColorStop(0,'rgba(33,111,165,.03)');g.addColorStop(.68,'rgba(32,113,168,.06)');g.addColorStop(.94,'rgba(43,128,184,.13)');g.addColorStop(1,'rgba(70,165,229,.23)');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,outer,0,TAU);ctx.arc(x,y,inner,0,TAU,true);ctx.fill('evenodd');
  ctx.strokeStyle=rgba(ICE,.45);ctx.lineWidth=.8;ctx.setLineDash([3,4]);ctx.beginPath();ctx.arc(x,y,outer,0,TAU);ctx.stroke();ctx.strokeStyle=rgba(AMBER,.5);ctx.beginPath();ctx.arc(x,y,inner,0,TAU);ctx.stroke();ctx.restore();
}
function innerWorkspaceBoundary(ctx,layout,alpha){
  if(alpha<.001)return;
  // This is a diagram annotation in front of the arm, not physical geometry.
  // The complete minimum-reach boundary must survive the pedestal overlap.
  ctx.save();ctx.globalAlpha*=alpha;ctx.beginPath();ctx.arc(layout.x,layout.y,.25*layout.scale,0,TAU);
  ctx.strokeStyle='rgba(4,20,35,.68)';ctx.lineWidth=3;ctx.stroke();
  ctx.strokeStyle=rgba(AMBER,.85);ctx.lineWidth=1;ctx.setLineDash([2.5,3]);ctx.stroke();ctx.restore();
}
function trace(ctx,qs,layout,count,alpha=.45){
  const u=Math.max(0,Math.min(qs.length-1,count-1)),i=Math.floor(u),pts=qs.slice(0,i+1).map(q=>armProjection(fk(q).tip,layout));
  if(i<qs.length-1)pts.push(armProjection(fk(lerpV(qs[i],qs[i+1],u-i)).tip,layout));
  if(pts.length<2)return;ctx.save();ctx.globalAlpha*=alpha;ctx.setLineDash([1,5]);path(ctx,pts);ctx.strokeStyle=ICE;ctx.lineWidth=1.7;ctx.lineCap='round';ctx.stroke();ctx.restore();
}
function iterationIndex(t){const d=sat(t)*ITERATION_ARC.at(-1);let i=0;while(i<ITERATION_ARC.length-2&&ITERATION_ARC[i+1]<d)i++;return i+(d-ITERATION_ARC[i])/(ITERATION_ARC[i+1]-ITERATION_ARC[i]||1);}
function iterationPose(t){const u=iterationIndex(t),i=Math.min(ITERATIONS.length-2,Math.floor(u));return lerpV(ITERATIONS[i].q,ITERATIONS[i+1].q,u-i);}

function componentAddition(ctx,q,layout,t,annotationAlpha){
  const [o,e,tip]=armPoints(q,layout),h1=[e[0],o[1]],h2=[tip[0],o[1]],v1=[tip[0],e[1]];
  const segments=[[o,h1,ICE],[h1,h2,AMBER],[h2,v1,ICE],[v1,tip,AMBER]];
  stroke(ctx,e,h1,ICE,.7,.2*t,[2,5]);stroke(ctx,e,v1,ICE,.7,.2*t,[2,5]);
  segments.forEach(([from,to,color],i)=>{const portion=ease(t*4-i);arrow(ctx,from,lerpV(from,to,portion),color,{width:1.1,head:6,alpha:.75});});
  label(ctx,'x','',h2[0]+12,h2[1]+7,{color:ICE,alpha:annotationAlpha*t,size:20});label(ctx,'y','',tip[0]+13,(tip[1]+o[1])/2+7,{color:AMBER,alpha:annotationAlpha*t,size:20});
}
function jacobianCue(ctx,q,layout,reveal,alpha,annotationAlpha){
  if(alpha<.001||reveal<.001)return;
  const pose=fk(q),tip=armProjection(pose.tip,layout),sum=q[0]+q[1],columns=[[-pose.tip[1],pose.tip[0]],[-.85*Math.sin(sum),.85*Math.cos(sum)]];
  const endpoints=columns.map((v,i)=>[tip[0]+v[0]*layout.scale*.20*reveal,tip[1]-v[1]*layout.scale*.20*reveal]);
  endpoints.forEach((end,i)=>arrow(ctx,tip,end,i===0?AMBER:ICE,{width:1.5,head:7,alpha}));
  const [o,e]=armPoints(q,layout);angleArc(ctx,o,q[0],q[0]+.20*reveal,40,alpha*.8);angleArc(ctx,e,sum,sum+.22*reveal,32,alpha*.8);
  label(ctx,'J','1',endpoints[0][0]-29,endpoints[0][1]+14,{color:AMBER,alpha:annotationAlpha*reveal,size:18});label(ctx,'J','2',endpoints[1][0]+10,endpoints[1][1]+8,{color:ICE,alpha:annotationAlpha*reveal,size:18});
}
function unreachableMarker(ctx,p,alpha){
  ctx.save();ctx.globalAlpha*=alpha;ctx.strokeStyle=AMBER;ctx.lineWidth=1;ctx.beginPath();ctx.arc(...p,5,0,TAU);ctx.stroke();stroke(ctx,[p[0]-2,p[1]-2],[p[0]+2,p[1]+2],AMBER,.8);stroke(ctx,[p[0]-2,p[1]+2],[p[0]+2,p[1]-2],AMBER,.8);ctx.restore();
}

export function drawInverse(ctx,step,progress,options={}){
  const p=sat(progress),a=readAlpha(options),b0=beat(p,0),b1=beat(p,1),b2=beat(p,2);
  // The final chapter gently dollies out to expose the entire ideal annulus;
  // joints still use the exact same metre-based coordinates and fixed lengths.
  const reveal=step===3?ease(p/.37):0,layout={x:lerp(120,284,reveal),y:lerp(303,217,reveal),scale:lerp(185,96,reveal)};
  const target=armProjection(TARGET_2,layout);
  ctx.save();glow(ctx,[315,236],210,'#276294',.12);
  if(step===3)workspace(ctx,layout,ease((reveal-.94)/.06));
  if(step===0){
    const q=[lerp(FORWARD_START[0],INITIAL[0],b0),lerp(FORWARD_START[1],INITIAL[1],b1)];
    robotArm(ctx,FORWARD_START,layout,{ghost:true,alpha:.2,base:false});
    const [o,e,t]=robotArm(ctx,q,layout);
    angleArc(ctx,o,0,q[0],49,.8);angleArc(ctx,e,q[0],q[0]+q[1],60,.3+.6*b1);
    stroke(ctx,o,[o[0]+62,o[1]],AMBER,.8,.35);
    componentAddition(ctx,q,layout,b2,a);
    const relativeMid=q[0]+q[1]/2,relativeAnchor=[e[0]+60*Math.cos(relativeMid),e[1]-60*Math.sin(relativeMid)];
    stroke(ctx,relativeAnchor,[relativeAnchor[0]+10,relativeAnchor[1]-17],AMBER,.8,a*b1*.65);
    label(ctx,'q','1',o[0]+56,o[1]-17,{color:AMBER,alpha:a});label(ctx,'q','2',relativeAnchor[0]+15,relativeAnchor[1]-25,{color:AMBER,alpha:a*b1});
    label(ctx,'p','',t[0]+14,t[1]-12,{color:WHITE,alpha:a*b2});
  } else if(step===1){
    robotArm(ctx,FORWARD_START,layout,{ghost:true,alpha:.14,base:false});
    const [, ,t]=robotArm(ctx,INITIAL,layout);targetMarker(ctx,target,.4+.6*b0,b0);
    arrow(ctx,t,lerpV(t,target,b1),AMBER,{alpha:.9,width:1.5,dash:[5,6]});pulseAlong(ctx,t,target,b2,AMBER,3);
    const corner=[target[0],t[1]];stroke(ctx,t,lerpV(t,corner,ease(b2*2)),ICE,.9,.38,[2,4]);stroke(ctx,corner,lerpV(corner,target,ease(b2*2-1)),ICE,.9,.38,[2,4]);
    label(ctx,'p','d',target[0]+20,target[1]+7,{color:AMBER,alpha:a*b0});label(ctx,'e','',(t[0]+target[0])/2+17,(t[1]+target[1])/2,{color:AMBER,alpha:a*b1,size:23});
  } else if(step===2){
    const t=p<1/3?0:p<2/3?.68*b1:.68+.32*b2;
    const q=iterationPose(t),index=iterationIndex(t);
    // Ghosts are actual previously computed DLS poses, not guessed silhouettes.
    for(const lag of [.24,.12]){if(t>lag)robotArm(ctx,iterationPose(t-lag),layout,{ghost:true,alpha:lag>.2?.11:.21,base:false});}
    trace(ctx,ITERATIONS.map(v=>v.q),layout,index+1,.72);targetMarker(ctx,target);const [, ,tip]=robotArm(ctx,q,layout);
    arrow(ctx,tip,target,AMBER,{alpha:.84,width:1.2,dash:[3,4]});
    label(ctx,'p','d',target[0]+20,target[1]+7,{color:AMBER,alpha:a});
    jacobianCue(ctx,q,layout,b0,.8*b0*(1-.75*b1),a*(1-b1));
  } else {
    // Both FK solutions meet TARGET_2 exactly. No cross-fade of endpoint
    // coordinates is used, and no link length is ever interpolated.
    robotArm(ctx,OTHER_SOLUTION,layout,{ghost:true,alpha:.14+.52*b0,base:false});
    const rangeAlpha=ease((reveal-.94)/.06);
    robotArm(ctx,SOLUTION,layout,{baseOpacity:1-.85*rangeAlpha});targetMarker(ctx,target);
    innerWorkspaceBoundary(ctx,layout,rangeAlpha);
    const [o,otherE]=armPoints(OTHER_SOLUTION,layout),[,e]=armPoints(SOLUTION,layout);
    const bothAlpha=a*ease(b0*1.4)*(1-.3*b1);
    label(ctx,'q','A',e[0]-32,e[1]-20,{color:WHITE,alpha:bothAlpha});label(ctx,'q','B',otherE[0]+21,otherE[1]+24,{color:ICE,alpha:bothAlpha});
    label(ctx,'p','d',target[0]+17,target[1]-12,{color:AMBER,alpha:a});
    unreachableMarker(ctx,[layout.x-layout.scale*.2,layout.y-layout.scale*.09],b1*(1-.5*b2));
    unreachableMarker(ctx,[layout.x+layout.scale*2.22,layout.y],b1*(1-.5*b2));
    if(b2>0){const outerPoint=[layout.x-1.95*layout.scale,layout.y];const innerPoint=[layout.x-.25*layout.scale,layout.y];stroke(ctx,outerPoint,innerPoint,ICE,.8,b2*.65,[3,5]);pearl(ctx,lerpV(innerPoint,outerPoint,b2),2.8,ICE,Math.sin(Math.PI*b2));}
  }
  ctx.restore();
}
