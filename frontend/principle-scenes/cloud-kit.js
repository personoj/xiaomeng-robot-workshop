import {clamp,mix,distance} from '../principle-math.js';

export const C={ice:'#8adaff',white:'#ecf8ff',orange:'#ffab56',green:'#83dfbc',red:'#ee8c88',muted:'#678da9'};
export const TAU=Math.PI*2;
export const ease=t=>{t=clamp(t);return t*t*t*(10+t*(-15+6*t));};
export const phase=(t,a=0,b=1)=>ease((t-a)/(b-a));
export const blend=(a,b,t)=>a.map((v,i)=>mix(v,b[i],t));
export function alpha(c,a,fn){if(a<=0)return;c.save();c.globalAlpha*=clamp(a);fn();c.restore();}
export function poly(c,pts,color,width=1,dash=[]){if(pts.length<2)return;c.beginPath();pts.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.strokeStyle=color;c.lineWidth=width;c.lineJoin='round';c.lineCap='round';c.setLineDash(dash);c.stroke();c.setLineDash([]);}
export function shape(c,pts,fill,stroke=null,width=1){if(!pts.length)return;c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}}
export function dot(c,p,r,fill){c.beginPath();c.arc(p[0],p[1],Math.max(.01,r),0,TAU);c.fillStyle=fill;c.fill();}
export function ring(c,p,r,color,width=1){c.beginPath();c.arc(p[0],p[1],Math.max(.01,r),0,TAU);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
export function glow(c,p,r,color,opacity=.24){alpha(c,opacity,()=>{const g=c.createRadialGradient(p[0],p[1],0,p[0],p[1],r);g.addColorStop(0,color);g.addColorStop(1,color+'00');dot(c,p,r,g);});}
const PEARLS=new Map();
function pearlSprite(c,color){
  if(PEARLS.has(color))return PEARLS.get(color);
  const canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(40,40):c.canvas?.ownerDocument?.createElement('canvas');
  if(!canvas)return null;canvas.width=40;canvas.height=40;const g=canvas.getContext('2d'),r=18,p=[20,20];
  const gradient=g.createRadialGradient(p[0]-r*.33,p[1]-r*.38,r*.02,p[0]+r*.2,p[1]+r*.25,r*1.05);
  gradient.addColorStop(0,'#f5fcff');gradient.addColorStop(.23,color);gradient.addColorStop(.72,color===C.orange?'#b55b22':'#367dad');gradient.addColorStop(1,'#10304d');dot(g,p,r,gradient);
  g.beginPath();g.arc(20,20,r*.92,3.5,5.3);g.strokeStyle='#effbff8c';g.lineWidth=.65;g.stroke();PEARLS.set(color,canvas);return canvas;
}
export function pearl(c,p,r,color=C.ice,emphasis=false){
  if(emphasis)glow(c,p,r*4,color,.2);
  const sprite=pearlSprite(c,color);if(sprite){const size=r*40/18;c.drawImage(sprite,p[0]-size/2,p[1]-size/2,size,size);return;}
  const g=c.createRadialGradient(p[0]-r*.33,p[1]-r*.38,r*.02,p[0]+r*.2,p[1]+r*.25,r*1.05);
  g.addColorStop(0,'#f5fcff');g.addColorStop(.23,color);g.addColorStop(.72,color===C.orange?'#b55b22':'#367dad');g.addColorStop(1,'#10304d');dot(c,p,r,g);
  if(r>3.5){c.beginPath();c.arc(p[0],p[1],r*.92,3.5,5.3);c.strokeStyle='#effbff8c';c.lineWidth=.65;c.stroke();}
}
export function arrow(c,a,b,color=C.ice,width=1.2){poly(c,[a,b],color,width);const angle=Math.atan2(b[1]-a[1],b[0]-a[0]),size=Math.min(7,distance(a,b)*.25);shape(c,[b,[b[0]-size*Math.cos(angle-.4),b[1]-size*Math.sin(angle-.4)],[b[0]-size*Math.cos(angle+.4),b[1]-size*Math.sin(angle+.4)]],color);}
export function partial(points,t){if(points.length<2)return points;let d=clamp(t)*points.slice(1).reduce((s,p,i)=>s+distance(p,points[i]),0);const out=[points[0]];for(let i=1;i<points.length;i++){const len=distance(points[i-1],points[i]);if(d>=len){out.push(points[i]);d-=len;}else{out.push(blend(points[i-1],points[i],d/(len||1)));break;}}return out;}
export function luminousPath(c,pts,t=1,color=C.ice,width=2.6){const shown=partial(pts,t);alpha(c,.10,()=>poly(c,shown,color,width+10));alpha(c,.20,()=>poly(c,shown,color,width+4));poly(c,shown,color,width);alpha(c,.75,()=>poly(c,shown,C.white,width*.27));}
export function label(c,text,x,y,{opacity=1,color=C.muted,size=17,align='center'}={}){alpha(c,opacity,()=>{c.font=`${size}px "Microsoft YaHei", system-ui, sans-serif`;c.textAlign=align;c.textBaseline='middle';c.fillStyle=color;c.strokeStyle='#071e31';c.lineWidth=4;c.lineJoin='round';c.strokeText(text,x,y);c.fillText(text,x,y);});}
export function math(c,base,sub,x,y,{opacity=1,color=C.white,size=25}={}){alpha(c,opacity,()=>{c.font=`italic ${size}px "Cambria Math", serif`;c.textAlign='left';c.textBaseline='alphabetic';c.fillStyle=color;c.strokeStyle='#071e31';c.lineWidth=4;c.lineJoin='round';c.strokeText(base,x,y);c.fillText(base,x,y);if(sub){const w=c.measureText(base).width;c.font=`${size*.6}px "Cambria Math", serif`;c.strokeText(sub,x+w+1,y+size*.23);c.fillText(sub,x+w+1,y+size*.23);}});}
export function glassBall(c,p,r,opacity=1){alpha(c,opacity,()=>{const g=c.createRadialGradient(p[0]-r*.28,p[1]-r*.4,r*.1,p[0],p[1],r);g.addColorStop(0,'#d4edff0d');g.addColorStop(.65,'#599ad70a');g.addColorStop(.88,'#8bc9ff20');g.addColorStop(1,'#bedfff4d');dot(c,p,r,g);ring(c,p,r,'#a0d9fd80',.9);c.beginPath();c.arc(p[0],p[1],r,3.45,5.3);c.strokeStyle='#e0f3ffa8';c.lineWidth=1.1;c.stroke();c.beginPath();c.arc(p[0],p[1],r,.17,1.7);c.strokeStyle='#ffa6538c';c.lineWidth=1;c.stroke();});}
export function glassBox(c,x,y,w,h,tint=C.ice){
  const z=5;shape(c,[[x,y],[x+w,y],[x+w+z,y-z],[x+z,y-z]],tint+'1d',tint+'66',.6);
  shape(c,[[x+w,y],[x+w+z,y-z],[x+w+z,y+h-z],[x+w,y+h]],tint+'20',tint+'70',.6);
  const g=c.createLinearGradient(x,y,x+w,y+h);g.addColorStop(0,tint+'1e');g.addColorStop(.5,tint+'06');g.addColorStop(1,tint+'27');shape(c,[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],g,tint+'96',.8);
}
