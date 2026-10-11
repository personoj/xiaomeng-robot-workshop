import * as T from 'three';
import {HOME_POSE,JOINT_LIMITS} from './welding-model.js';
const origins=[[0,0,.45],[.075,0,0],[0,0,.84],[0,0,.195],[1.1,0,0],[0,0,0]];
const axes=[[0,0,1],[0,1,0],[0,-1,0],[-1,0,0],[0,-1,0],[-1,0,0]].map(a=>new T.Vector3(...a));
const wire=new T.Vector3(.72,0,.69).normalize();
const tip=new T.Vector3(.075+.349,0,.083).addScaledVector(wire,.059);
export function weldFK(q){
  const m=new T.Matrix4().makeRotationZ(Math.PI);m.setPosition(-.81,.03,.765);
  for(let i=0;i<6;i++)m.multiply(new T.Matrix4().makeTranslation(...origins[i])).multiply(new T.Matrix4().makeRotationAxis(axes[i],q[i]*Math.PI/180));
  return {point:tip.clone().applyMatrix4(m),direction:wire.clone().transformDirection(m)};
}
function solve(a,b){
  const n=b.length,m=a.map((r,i)=>[...r,b[i]]);
  for(let i=0;i<n;i++){
    let k=i;for(let j=i+1;j<n;j++)if(Math.abs(m[j][i])>Math.abs(m[k][i]))k=j;
    [m[i],m[k]]=[m[k],m[i]];const d=m[i][i];if(Math.abs(d)<1e-12)return Array(n).fill(0);
    for(let j=i;j<=n;j++)m[i][j]/=d;
    for(let j=0;j<n;j++)if(j!==i){const f=m[j][i];for(let k=i;k<=n;k++)m[j][k]-=f*m[i][k];}
  }return m.map(r=>r[n]);
}
export function weldIK(point,direction,seed=HOME_POSE){
  let q=[...seed];const p=new T.Vector3(...point),d=new T.Vector3(...direction).normalize(),w=.30;
  for(let iteration=0;iteration<180;iteration++){
    const fk=weldFK(q),pe=p.clone().sub(fk.point),de=d.clone().sub(fk.direction);
    if(pe.length()<.00015&&de.length()<.0015)return {ok:true,q,error:pe.length()};
    const e=[...pe.toArray(),...de.multiplyScalar(w).toArray()];
    const columns=q.map((_,j)=>{const a=[...q];a[j]+=.05;const f=weldFK(a);return [...f.point.sub(fk.point).multiplyScalar(20).toArray(),...f.direction.sub(fk.direction).multiplyScalar(20*w).toArray()];});
    const a=columns.map((x,i)=>columns.map((y,j)=>x.reduce((s,v,k)=>s+v*y[k],0)+(i===j?1e-7:0)));
    const b=columns.map(x=>x.reduce((s,v,k)=>s+v*e[k],0)),delta=solve(a,b),max=Math.max(1,...delta.map(v=>Math.abs(v)/4));
    q=q.map((v,i)=>T.MathUtils.clamp(v+delta[i]/max,JOINT_LIMITS[i][0]+.1,JOINT_LIMITS[i][1]-.1));
  }
  return {ok:false,q,error:weldFK(q).point.distanceTo(p)};
}
