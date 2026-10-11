export const clamp = (t, a = 0, b = 1) => Math.max(a, Math.min(b, t));
export const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
export const mix = (a,b,t) => a+(b-a)*t;
export const distance = (a,b) => Math.hypot(...a.map((v,i)=>v-b[i]));
export const rotate2 = ([x,y], a) => [x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)];
export function fk([q1,q2], lengths = [1.1,.85]) {
  const elbow=[lengths[0]*Math.cos(q1),lengths[0]*Math.sin(q1)];
  return { elbow, tip:[elbow[0]+lengths[1]*Math.cos(q1+q2),elbow[1]+lengths[1]*Math.sin(q1+q2)] };
}
export function ik([x,y], lengths = [1.1,.85], sign = 1) {
  const [a,b]=lengths,c=(x*x+y*y-a*a-b*b)/(2*a*b);
  // A boundary target can produce c=1+epsilon through floating point rounding.
  if (!Number.isFinite(c)||Math.abs(c)>1+1e-12) return null;
  const q2=sign*Math.acos(clamp(c,-1,1));
  return [Math.atan2(y,x)-Math.atan2(b*Math.sin(q2),a+b*Math.cos(q2)),q2];
}
export function ikIterations(target, initial=[1.1,-.5], count=28) {
  let q=[...initial];const result=[];
  for(let i=0;i<=count;i++){
    const pose=fk(q),e=target.map((x,k)=>x-pose.tip[k]);
    result.push({q:[...q],error:Math.hypot(...e),...pose});
    const [a,b]=q,c=a+b,j=[[-1.1*Math.sin(a)-.85*Math.sin(c),-.85*Math.sin(c)],[1.1*Math.cos(a)+.85*Math.cos(c),.85*Math.cos(c)]];
    // Damped least squares: J^T (J J^T + lambda^2 I)^-1 e.
    const aa=j[0][0]**2+j[0][1]**2+.015,ab=j[0][0]*j[1][0]+j[0][1]*j[1][1],bb=j[1][0]**2+j[1][1]**2+.015,det=aa*bb-ab*ab;
    const y=[(bb*e[0]-ab*e[1])/det,(-ab*e[0]+aa*e[1])/det];
    const delta=q.map((_,k)=>(j[0][k]*y[0]+j[1][k]*y[1])*.6);
    // Scale the whole DLS direction. Clamping joints independently can reverse
    // the Cartesian descent direction and make the displayed error increase.
    let scale=Math.min(1,.18/(Math.max(...delta.map(Math.abs))||1));
    for(let backtrack=0;backtrack<20;backtrack++){
      const next=q.map((v,k)=>v+delta[k]*scale);
      if(distance(fk(next).tip,target)<=result.at(-1).error){q=next;break;}
      scale*=.5;
    }
  }
  return result;
}
export function makeCloud() {
  const pts=[];
  for(let pipe=0;pipe<2;pipe++)for(let x=0;x<22;x++)for(let k=0;k<14;k++){
    const a=k/14*Math.PI*2,j=.006*Math.sin(x*7+k*13);
    pts.push([-1.3+x*2.6/21,pipe*.71-.355+(.33+j)*Math.cos(a),(.33+j)*Math.sin(a)]);
  }
  return pts;
}
export function farthestPoints(points,count,seed=0){
  count=Math.min(Math.max(0,Math.floor(count)),points.length);
  if(!count)return [];
  if(!Number.isInteger(seed)||seed<0||seed>=points.length)throw new RangeError('FPS seed must index the input point cloud');
  const selected=[seed],nearest=points.map(p=>distance(p,points[seed])**2);
  while(selected.length<Math.min(count,points.length)){
    let best=-1;for(let i=0;i<points.length;i++)if(!selected.includes(i)&&(best<0||nearest[i]>nearest[best]))best=i;
    selected.push(best);for(let i=0;i<points.length;i++)nearest[i]=Math.min(nearest[i],distance(points[i],points[best])**2);
  }
  return selected;
}
export const neighborhood=(pts,center,radius)=>pts.map((p,i)=>distance(p,center)<=radius?i:-1).filter(i=>i>=0);
export const PLAN={start:[1,4],goal:[9,4],obstacles:[{c:[4.1,4],r:1.0},{c:[6.7,5.8],r:.85},{c:[6.6,1.8],r:.65}],body:.3,margin:.22};
export function pointSegmentDistance(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1));
  return distance(p,[a[0]+t*dx,a[1]+t*dy]);
}
export function clearSegment(a,b,plan=PLAN){return plan.obstacles.every(o=>pointSegmentDistance(o.c,a,b)>=o.r+plan.body+plan.margin);}
export function planRoute(plan=PLAN){
  const cell=.25,nx=41,ny=33,key=([x,y])=>x+','+y,world=([x,y])=>[x*cell,y*cell];
  const start=plan.start.map(v=>v/cell),goal=plan.goal.map(v=>v/cell),open=[start],g=new Map([[key(start),0]]),came=new Map(),closed=new Set(),visited=[];
  // This teaching grid has fixed .25 m nodes. Reject invalid or obstructed
  // endpoints instead of silently changing the requested target.
  if(![start,goal].every(p=>p.every(Number.isInteger)&&p[0]>=1&&p[0]<nx-1&&p[1]>=1&&p[1]<ny-1)
    ||!clearSegment(plan.start,plan.start,plan)||!clearSegment(plan.goal,plan.goal,plan))return {visited,path:[],simplified:[]};
  let path=[];
  while(open.length){
    open.sort((a,b)=>(g.get(key(a))+distance(a,goal))-(g.get(key(b))+distance(b,goal)));
    const current=open.shift(),ck=key(current);if(closed.has(ck))continue;closed.add(ck);visited.push(world(current));
    if(ck===key(goal)){let c=current;while(c){path.unshift(world(c));c=came.get(key(c));}break;}
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      const n=[current[0]+dx,current[1]+dy],nk=key(n);if(n[0]<1||n[0]>=nx-1||n[1]<1||n[1]>=ny-1||closed.has(nk)||!clearSegment(world(current),world(n),plan))continue;
      // In addition to the continuous edge test, do not cut a grid corner
      // when either adjacent cardinal edge is blocked.
      if(dx&&dy&&(!clearSegment(world(current),world([current[0]+dx,current[1]]),plan)
        ||!clearSegment(world(current),world([current[0],current[1]+dy]),plan)))continue;
      const cost=g.get(ck)+Math.hypot(dx,dy);if(cost<(g.get(nk)??Infinity)){g.set(nk,cost);came.set(nk,current);open.push(n);}
    }
  }
  const simplified=[];for(let i=0;i<path.length;){simplified.push(path[i]);if(i===path.length-1)break;let j=path.length-1;while(j>i+1&&!clearSegment(path[i],path[j],plan))j--;i=j;}
  return {visited,path,simplified};
}
export function alongPath(path,t){
  const segments=path.slice(1).map((p,i)=>distance(p,path[i])),total=segments.reduce((a,b)=>a+b,0);let d=clamp(t)*total;
  for(let i=0;i<segments.length;i++){if(d<=segments[i])return path[i].map((v,k)=>mix(v,path[i+1][k],d/(segments[i]||1)));d-=segments[i];}
  return path.at(-1);
}
