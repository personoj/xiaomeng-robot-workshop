// Deterministic studio materials for the two spatial teaching scenes.
// Geometry, motion and light all remain code-native; ImageGen is the art direction.
export const ICE = '#84d8ff';
export const AMBER = '#ffb15b';
export const WHITE = '#f3f9ff';
export const TAU = Math.PI * 2;
export const sat = t => Math.max(0, Math.min(1, t));
export const ease = t => { t = sat(t); return t*t*t*(10+t*(-15+6*t)); };
export const lerp = (a,b,t) => a+(b-a)*t;
export const lerpV = (a,b,t) => a.map((x,i)=>lerp(x,b[i],t));
export const beat = (p,index) => ease(p*3-index);
export const project = ([x,y,z=0]) => [300+72*(x-y), 280+30*(x+y)-83*z];
export function rgba(hex,a){const n=parseInt(hex.slice(1),16);return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`;}
export function path(ctx,pts,close=false){ctx.beginPath();ctx.moveTo(...pts[0]);for(const p of pts.slice(1))ctx.lineTo(...p);if(close)ctx.closePath();}
export function glow(ctx,p,r,color,alpha=.6){
  ctx.save();const g=ctx.createRadialGradient(...p,0,...p,r);g.addColorStop(0,rgba(color,alpha));g.addColorStop(.3,rgba(color,alpha*.23));g.addColorStop(1,rgba(color,0));ctx.fillStyle=g;ctx.beginPath();ctx.arc(...p,r,0,TAU);ctx.fill();ctx.restore();
}
export function pearl(ctx,p,r=6,color=WHITE,alpha=1){
  ctx.save();ctx.globalAlpha*=alpha;glow(ctx,p,r*4,color,.32);
  const g=ctx.createRadialGradient(p[0]-r*.33,p[1]-r*.42,r*.05,p[0],p[1],r);
  g.addColorStop(0,'#ffffff');g.addColorStop(.2,color);g.addColorStop(.58,rgba(color,.92));g.addColorStop(1,'#386584');
  ctx.fillStyle=g;ctx.strokeStyle=rgba(WHITE,.86);ctx.lineWidth=.7;ctx.beginPath();ctx.arc(...p,r,0,TAU);ctx.fill();ctx.stroke();
  ctx.fillStyle=rgba(WHITE,.92);ctx.beginPath();ctx.ellipse(p[0]-r*.23,p[1]-r*.33,r*.33,r*.19,-.3,0,TAU);ctx.fill();ctx.restore();
}
export function stroke(ctx,a,b,color=ICE,width=1.5,alpha=1,dash=null){
  ctx.save();ctx.globalAlpha*=alpha;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash||[]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();ctx.restore();
}
export function arrow(ctx,a,b,color=ICE,{alpha=1,width=1.8,head=7,glowing=false,dash=null}={}){
  const d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(d<.01||alpha<.001)return;
  ctx.save();ctx.globalAlpha*=alpha;
  if(glowing){ctx.shadowColor=color;ctx.shadowBlur=8;}
  stroke(ctx,a,b,color,width,1,dash);
  const u=[(b[0]-a[0])/d,(b[1]-a[1])/d],n=[-u[1],u[0]],h=Math.min(head,d*.18);
  const back=[b[0]-u[0]*h,b[1]-u[1]*h];path(ctx,[b,[back[0]+n[0]*h*.4,back[1]+n[1]*h*.4],[back[0]-n[0]*h*.4,back[1]-n[1]*h*.4]],true);
  ctx.fillStyle=color;ctx.fill();ctx.restore();
}
export function tube(ctx,a,b,width=20,{ghost=false,alpha=1}={}){
  const dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy);if(d<.01)return;
  const ux=dx/d,uy=dy/d,nx=-uy,ny=ux;
  ctx.save();ctx.globalAlpha*=alpha;ctx.translate(...a);ctx.rotate(Math.atan2(dy,dx));
  ctx.beginPath();ctx.roundRect(0,-width/2,d,width,width*.43);
  const g=ctx.createLinearGradient(0,-width/2,0,width/2);
  if(ghost){g.addColorStop(0,'#5d97bb');g.addColorStop(.45,'#1d4c73');g.addColorStop(1,'#0a2139');}
  else{g.addColorStop(0,'#d8e8f8');g.addColorStop(.13,'#ffffff');g.addColorStop(.36,'#d9dfed');g.addColorStop(.68,'#a3aabc');g.addColorStop(.88,'#c8d5e5');g.addColorStop(1,'#647587');}
  ctx.fillStyle=g;ctx.fill();ctx.strokeStyle=ghost?'#6cc7fa':'#e2ecfb';ctx.lineWidth=1;ctx.stroke();
  const reflection=ctx.createLinearGradient(0,0,d,0);reflection.addColorStop(0,'rgba(255,255,255,0)');reflection.addColorStop(.42,ghost?'rgba(145,211,255,.2)':'rgba(255,255,255,.7)');reflection.addColorStop(1,'rgba(255,255,255,0)');
  ctx.strokeStyle=reflection;ctx.lineWidth=1.25;ctx.beginPath();ctx.moveTo(width*.5,-width*.32);ctx.lineTo(d-width*.4,-width*.32);ctx.stroke();ctx.restore();
}
export function joint(ctx,p,r,{ghost=false,alpha=1}={}){
  ctx.save();ctx.globalAlpha*=alpha;
  // Offset housing plus concentric front face provides a visible axis depth.
  const shell=ctx.createLinearGradient(p[0]-r,p[1]-r,p[0]+r,p[1]+r);
  shell.addColorStop(0,ghost?'#5f9cc4':'#d0d9e6');shell.addColorStop(.25,ghost?'#1b4568':'#576372');shell.addColorStop(.7,ghost?'#163958':'#121c29');shell.addColorStop(1,ghost?'#75bde9':'#929ca9');
  ctx.fillStyle=shell;ctx.beginPath();ctx.ellipse(p[0]+3,p[1]-2,r+2,r+1,0,0,TAU);ctx.fill();
  const face=ctx.createRadialGradient(p[0]-r*.3,p[1]-r*.4,1,p[0],p[1],r);
  face.addColorStop(0,ghost?'#477394':'#414a5a');face.addColorStop(.75,ghost?'#123350':'#121a23');face.addColorStop(1,ghost?'#3d8bbd':'#030b12');
  ctx.fillStyle=face;ctx.strokeStyle=ghost?'#64baf1':'#d3dfeb';ctx.lineWidth=1;ctx.beginPath();ctx.arc(...p,r,0,TAU);ctx.fill();ctx.stroke();
  ctx.strokeStyle=rgba(ICE,ghost?.8:.75);ctx.lineWidth=.65;ctx.beginPath();ctx.arc(...p,r*.79,0,TAU);ctx.stroke();ctx.restore();
}
export function label(ctx,base,index,x,y,{color=WHITE,size=19,alpha=1,superIndex=false,align='left'}={}){
  if(alpha<.025)return;ctx.save();ctx.globalAlpha*=alpha;ctx.font=`italic ${size}px Cambria, Georgia, serif`;ctx.textBaseline='alphabetic';ctx.textAlign='left';
  const bw=ctx.measureText(base).width,subSize=size*.59;ctx.font=`italic ${subSize}px Cambria, Georgia, serif`;const iw=index?ctx.measureText(index).width:0;
  const w=bw+iw+3;if(align==='right')x-=w;if(align==='center')x-=w/2;
  // Labels are positioned away from geometry. Only a one-pixel navy ink halo
  // remains for anti-aliasing; there is no rectangular mask over the diagram.
  ctx.strokeStyle='rgba(3,16,29,.58)';ctx.lineWidth=1.25;ctx.lineJoin='round';ctx.fillStyle=color;ctx.font=`italic ${size}px Cambria, Georgia, serif`;ctx.strokeText(base,x,y);ctx.fillText(base,x,y);if(index){ctx.font=`italic ${subSize}px Cambria, Georgia, serif`;const iy=y+(superIndex?-size*.48:size*.24);ctx.strokeText(index,x+bw+1,iy);ctx.fillText(index,x+bw+1,iy);}ctx.restore();
}
export function glassPlane(ctx,opacity=1){
  ctx.save();ctx.globalAlpha*=opacity;
  const corners=[[-1.8,-1.8,0],[1.8,-1.8,0],[1.8,1.8,0],[-1.8,1.8,0]].map(project);
  const down=corners.map(([x,y])=>[x,y+5]);
  path(ctx,[corners[1],corners[2],corners[3],down[3],down[2],down[1]],true);ctx.fillStyle='rgba(45,102,151,.16)';ctx.fill();
  path(ctx,corners,true);const g=ctx.createLinearGradient(220,160,350,400);g.addColorStop(0,'rgba(69,136,193,.07)');g.addColorStop(.64,'rgba(62,118,174,.22)');g.addColorStop(1,'rgba(97,167,223,.25)');ctx.fillStyle=g;ctx.fill();
  ctx.strokeStyle='rgba(125,197,244,.64)';ctx.lineWidth=1;ctx.stroke();ctx.save();ctx.clip();
  for(let v=-1.6;v<=1.61;v+=.32){stroke(ctx,project([-1.8,v]),project([1.8,v]),ICE,.5,.16);stroke(ctx,project([v,-1.8]),project([v,1.8]),ICE,.5,.16);}
  ctx.restore();stroke(ctx,corners[2],corners[3],ICE,1.2,.8);stroke(ctx,corners[1],corners[2],ICE,1.2,.55);
  // Reflected underside light remains subordinate to the geometry.
  glow(ctx,[300,390],70,ICE,.08);ctx.restore();
}
export function triad(ctx,origin,{angle=0,color=ICE,scale=1,alpha=1,progress=1}={}){
  const o=project(origin),c=Math.cos(angle),s=Math.sin(angle),len=.92*scale,p=sat(progress);
  for(const delta of [[len*c,len*s,0],[-len*s,len*c,0],[0,0,len]]){
    const end=project(origin.map((v,i)=>v+delta[i]*p));arrow(ctx,o,end,color,{alpha,width:1.8,head:9,glowing:true});
  }glow(ctx,[o[0],o[1]+4],20,color,.16*alpha);pearl(ctx,o,3.6,color,alpha);
}
export function pulseAlong(ctx,a,b,t,color=ICE,r=2.5){if(t<=0||t>=1)return;pearl(ctx,lerpV(a,b,t),r,color,Math.sin(Math.PI*t));}
export function curvedArrow(ctx,points,color=ICE,alpha=1,width=1.5){
  if(points.length<2)return;ctx.save();ctx.globalAlpha*=alpha;ctx.lineCap='round';path(ctx,points);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();arrow(ctx,points[Math.max(0,points.length-6)],points.at(-1),color,{width,head:7});ctx.restore();
}
export function partialPath(points,t){const u=sat(t)*(points.length-1),i=Math.floor(u),out=points.slice(0,i+1);if(i<points.length-1)out.push(lerpV(points[i],points[i+1],u-i));return out;}
